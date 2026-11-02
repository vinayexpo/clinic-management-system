<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\WhatsAppConnection;
use App\Support\WhatsAppClient;
use App\Support\WhatsAppSender;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class WhatsAppCoexistenceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'whatsapp.coexistence_ready' => true,
            'whatsapp.app_id' => '1234', 'whatsapp.app_secret' => 'test-secret',
            'whatsapp.signup_config_id' => '5678', 'whatsapp.webhook_verify_token' => 'verify-secret',
            'whatsapp.graph_version' => 'v26.0',
        ]);
        Http::preventStrayRequests();
        $this->actingAs(User::factory()->create(['role' => 'admin']));
    }

    private function start(): string
    {
        return $this->postJson('/api/v1/whatsapp/coexistence/start', [
            'phone' => '+919876543210', 'sync_consent' => true,
        ])->assertOk()->assertJsonMissing(['app_secret' => 'test-secret'])->json('data.state');
    }

    private function fakeMeta(array $phoneOverrides = [], array $debugOverrides = [], array $responseOverrides = []): void
    {
        Http::swap(new Factory);
        Http::preventStrayRequests();
        Http::fake(array_replace([
            '*/oauth/access_token*' => Http::response(['access_token' => 'business-token']),
            '*/debug_token*' => Http::response(['data' => array_merge([
                'app_id' => '1234', 'is_valid' => true,
                'scopes' => ['whatsapp_business_management', 'whatsapp_business_messaging'],
            ], $debugOverrides)]),
            '*/555/phone_numbers*' => Http::response(['data' => [array_merge([
                'id' => '777', 'display_phone_number' => '+91 98765 43210',
                'is_on_biz_app' => true, 'platform_type' => 'CLOUD_API',
            ], $phoneOverrides)]]),
            '*/555/subscribed_apps' => Http::response(['success' => true]),
            '*/777/smb_app_data' => Http::response(['request_id' => 'sync-receipt']),
            '*/777/messages' => Http::response(['messages' => [['id' => 'wamid.test']]]),
        ], $responseOverrides));
    }

    private function complete(string $state): TestResponse
    {
        return $this->postJson('/api/v1/whatsapp/coexistence/complete', [
            'state' => $state, 'code' => 'one-time-code', 'waba_id' => '555',
        ]);
    }

    public function test_connection_requires_explicit_sync_consent_and_international_number(): void
    {
        $this->postJson('/api/v1/whatsapp/coexistence/start', ['phone' => '9876543210', 'sync_consent' => false])
            ->assertUnprocessable()->assertJsonValidationErrors(['phone', 'sync_consent']);
        Http::assertNothingSent();
    }

    public function test_unconfigured_onboarding_fails_closed(): void
    {
        config(['whatsapp.coexistence_ready' => false]);
        $this->postJson('/api/v1/whatsapp/coexistence/start', ['phone' => '+919876543210', 'sync_consent' => true])->assertUnprocessable();
        Http::assertNothingSent();
    }

    public function test_reception_cannot_start_or_complete_onboarding(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'receptionist']));
        $this->postJson('/api/v1/whatsapp/coexistence/start')->assertForbidden();
        $this->postJson('/api/v1/whatsapp/coexistence/complete')->assertForbidden();
        Http::assertNothingSent();
    }

    public function test_expired_or_foreign_attempt_cannot_exchange_a_code(): void
    {
        $state = $this->start();
        $this->actingAs(User::factory()->create(['role' => 'admin']));
        $this->complete($state)->assertUnprocessable();
        Http::assertNothingSent();
    }

    public function test_attempt_expires_after_ten_minutes(): void
    {
        $state = $this->start();
        $this->travel(11)->minutes();
        $this->complete($state)->assertUnprocessable();
        Http::assertNothingSent();
    }

    public function test_existing_business_app_number_is_verified_subscribed_and_synchronized(): void
    {
        $this->fakeMeta();
        $state = $this->start();
        $this->complete($state)->assertOk()->assertJsonPath('data.status', 'connected')->assertJsonMissingPath('data.token');
        $connection = WhatsAppConnection::findOrFail(1);
        $this->assertSame('business-token', $connection->token);
        $this->assertNotSame('business-token', DB::table('whatsapp_connections')->value('token'));
        $this->assertSame('sync-receipt', $connection->history_sync_request_id);
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/555/subscribed_apps') && $r->method() === 'POST');
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/777/smb_app_data') && $r['sync_type'] === 'history');
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/777/smb_app_data') && $r['sync_type'] === 'smb_app_state_sync');
        Http::assertNotSent(fn ($r) => str_contains($r->url(), '/register') || str_contains($r->url(), '/deregister'));
        $this->complete($state)->assertUnprocessable();
        $this->getJson('/api/v1/whatsapp/status')->assertOk()->assertJsonMissingPath('data.coexistence.connection.token');
    }

    public function test_cloud_api_only_number_is_not_misreported_as_coexistence(): void
    {
        $this->fakeMeta(['is_on_biz_app' => false]);
        $this->complete($this->start())->assertUnprocessable();
        $this->assertDatabaseCount('whatsapp_connections', 0);
        Http::assertNotSent(fn ($r) => $r->method() === 'POST');
    }

    public function test_a_different_number_is_rejected(): void
    {
        $this->fakeMeta(['display_phone_number' => '+919000000000']);
        $this->complete($this->start())->assertUnprocessable();
        $this->assertDatabaseCount('whatsapp_connections', 0);
    }

    public function test_token_for_another_app_or_missing_permission_is_rejected(): void
    {
        $this->fakeMeta([], ['app_id' => '9999']);
        $this->complete($this->start())->assertUnprocessable();
        $this->assertDatabaseCount('whatsapp_connections', 0);
    }

    public function test_provider_errors_do_not_return_codes_or_secrets(): void
    {
        Http::fake(['*/oauth/access_token*' => Http::response(['error' => ['message' => 'Secret test-secret one-time-code']], 400)]);
        $response = $this->complete($this->start())->assertUnprocessable();
        $this->assertStringNotContainsString('test-secret', $response->getContent());
        $this->assertStringNotContainsString('one-time-code', $response->getContent());
    }

    public function test_connected_credentials_are_used_for_existing_template_sender(): void
    {
        $this->fakeMeta();
        $this->complete($this->start())->assertOk();
        $result = app(WhatsAppClient::class)->sendTemplate('+919000000000', 'approved_template', ['Asha']);
        $this->assertTrue($result['ok']);
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/777/messages') && $r->hasHeader('Authorization', 'Bearer business-token'));
    }

    public function test_a_disconnected_coexistence_connection_falls_back_to_the_standard_number(): void
    {
        $this->fakeMeta();
        $this->complete($this->start())->assertOk();
        WhatsAppConnection::findOrFail(1)->update(['status' => 'disconnected']);
        config(['whatsapp.phone_number_id' => 'old-number', 'whatsapp.access_token' => 'old-token']);

        $sender = WhatsAppSender::resolve();
        $this->assertSame('standard', $sender['source']);
        $this->assertSame('old-number', $sender['phone_number_id']);

        Http::fake(['*/old-number/messages' => Http::response(['messages' => [['id' => 'wamid.standard']]], 200)]);
        $result = app(WhatsAppClient::class)->sendTemplate('+919000000000', 'approved_template', []);
        $this->assertTrue($result['ok']);
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/old-number/messages') && $r->hasHeader('Authorization', 'Bearer old-token'));
    }

    public function test_meta_connection_failure_has_a_safe_error(): void
    {
        Http::fake(['*/oauth/access_token*' => Http::failedConnection()]);
        $this->complete($this->start())->assertStatus(502);
    }

    public function test_connecting_does_not_allow_tests_to_bypass_disabled_delivery(): void
    {
        config(['whatsapp.enabled' => false, 'whatsapp.log_only' => false]);
        $this->postJson('/api/v1/whatsapp/test', ['phone' => '+919876543210', 'message' => 'Test'])
            ->assertUnprocessable();
        Http::assertNothingSent();
    }

    public function test_connection_identity_exists_before_subscription_and_preserves_early_webhooks(): void
    {
        $this->fakeMeta(responseOverrides: ['*/555/subscribed_apps' => function () {
            $connection = WhatsAppConnection::findOrFail(1);
            $this->assertSame('connecting', $connection->status);
            $this->assertNull(WhatsAppSender::resolve());
            $connection->update(['last_webhook_at' => now()]);

            return Http::response(['success' => true]);
        }]);
        $this->complete($this->start())->assertOk();
        $this->assertNotNull(WhatsAppConnection::findOrFail(1)->last_webhook_at);
    }

    public function test_a_disconnect_during_subscription_is_never_overwritten(): void
    {
        $this->fakeMeta(responseOverrides: ['*/555/subscribed_apps' => function () {
            WhatsAppConnection::findOrFail(1)->update(['status' => 'disconnected', 'disconnected_at' => now(), 'lifecycle_event_at' => now()]);

            return Http::response(['success' => true]);
        }]);
        $this->complete($this->start())->assertConflict();
        $this->assertSame('disconnected', WhatsAppConnection::findOrFail(1)->status);
        Http::assertNotSent(fn ($r) => str_contains($r->url(), '/smb_app_data'));
    }

    public function test_a_disconnect_during_verification_prevents_publication(): void
    {
        $this->fakeMeta();
        $this->complete($this->start())->assertOk();
        $this->travel(5)->seconds();
        $this->fakeMeta(responseOverrides: ['*/555/phone_numbers*' => function () {
            WhatsAppConnection::findOrFail(1)->update(['status' => 'disconnected', 'disconnected_at' => now(), 'lifecycle_event_at' => now()]);

            return Http::response(['data' => [['id' => '777', 'display_phone_number' => '+919876543210', 'is_on_biz_app' => true, 'platform_type' => 'CLOUD_API']]]);
        }]);
        $this->complete($this->start())->assertConflict();
        $this->assertSame('disconnected', WhatsAppConnection::findOrFail(1)->status);
    }

    public function test_rejected_contacts_do_not_block_history_and_can_be_safely_retried(): void
    {
        $this->fakeMeta(responseOverrides: ['*/777/smb_app_data' => fn ($r) => $r['sync_type'] === 'smb_app_state_sync'
            ? Http::response(['error' => ['message' => 'Rejected']], 400)
            : Http::response(['request_id' => 'history-receipt'])]);
        $this->complete($this->start())->assertStatus(502);
        $connection = WhatsAppConnection::findOrFail(1);
        $this->assertSame('rejected', $connection->contacts_sync_request_id);
        $this->assertSame('history-receipt', $connection->history_sync_request_id);
        $this->fakeMeta();
        $this->complete($this->start())->assertOk();
        $this->assertSame('sync-receipt', $connection->fresh()->contacts_sync_request_id);
        Http::assertNotSent(fn ($r) => str_contains($r->url(), '/smb_app_data') && $r['sync_type'] === 'history');
    }

    public function test_uncertain_contacts_never_replay_but_history_still_starts(): void
    {
        $this->fakeMeta(responseOverrides: ['*/777/smb_app_data' => function ($r) {
            if ($r['sync_type'] === 'smb_app_state_sync') {
                throw new ConnectionException('Timeout');
            }

            return Http::response(['request_id' => 'history-receipt']);
        }]);
        $this->complete($this->start())->assertStatus(502);
        $connection = WhatsAppConnection::findOrFail(1);
        $this->assertSame('pending_confirmation', $connection->contacts_sync_request_id);
        $this->assertSame('history-receipt', $connection->history_sync_request_id);
        $this->fakeMeta();
        $this->complete($this->start())->assertStatus(502);
        Http::assertNotSent(fn ($r) => str_contains($r->url(), '/smb_app_data'));
    }

    public function test_a_connection_lock_prevents_parallel_code_exchange(): void
    {
        $state = $this->start();
        $lock = Cache::lock('whatsapp:connection', 120);
        $lock->get();
        try {
            $this->complete($state)->assertConflict();
            Http::assertNothingSent();
        } finally {
            $lock->release();
        }
    }
}
