<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\WhatsAppConnection;
use App\Models\WhatsAppWebhookEvent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class WhatsAppWebhookTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['whatsapp.app_secret' => 'webhook-test-secret', 'whatsapp.webhook_verify_token' => 'verify-test-token']);
        Http::preventStrayRequests();
    }

    private function connection(array $attributes = []): WhatsAppConnection
    {
        return WhatsAppConnection::create(array_merge([
            'id' => 1,
            'waba_id' => 'waba-1',
            'phone_number_id' => 'phone-1',
            'display_phone_number' => '15550000001',
            'token' => 'private-token',
            'status' => 'connected',
            'connected_at' => now()->subMinute(),
            'lifecycle_event_at' => now()->subMinute(),
            'sync_progress' => 0,
            'history_status' => 'requested',
        ], $attributes));
    }

    private function payload(string $field = 'smb_message_echoes', ?array $value = null, string $wabaId = 'waba-1'): array
    {
        return [
            'object' => 'whatsapp_business_account',
            'entry' => [[
                'id' => $wabaId,
                'time' => now()->getTimestamp(),
                'changes' => [[
                    'field' => $field,
                    'value' => $value ?? [
                        'metadata' => ['phone_number_id' => 'phone-1'],
                        'message_echoes' => [[
                            'from' => '15550000001',
                            'to' => '15550000002',
                            'id' => 'wamid.echo-1',
                            'type' => 'text',
                            'text' => ['body' => 'Sent from the Business app'],
                        ]],
                    ],
                ]],
            ]],
        ];
    }

    private function signed(array $payload): TestResponse
    {
        $body = json_encode($payload, JSON_THROW_ON_ERROR);

        return $this->call('POST', '/api/v1/whatsapp/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $body, 'webhook-test-secret'),
        ], $body);
    }

    public function test_verification_returns_the_plain_text_challenge(): void
    {
        $this->get('/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-test-token&hub.challenge=123456')
            ->assertOk()->assertContent('123456')->assertHeader('Content-Type', 'text/plain; charset=UTF-8');
    }

    public function test_verification_requires_a_nonempty_configured_token_and_subscribe_mode(): void
    {
        $this->get('/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123')->assertForbidden();
        $this->get('/api/v1/whatsapp/webhook?hub.mode=unsubscribe&hub.verify_token=verify-test-token&hub.challenge=123')->assertForbidden();
        config(['whatsapp.webhook_verify_token' => '']);
        $this->get('/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=123')->assertForbidden();
    }

    public function test_missing_malformed_and_invalid_signatures_are_rejected(): void
    {
        $connection = $this->connection();
        foreach ([null, 'sha1='.str_repeat('a', 40), 'sha256=invalid', 'sha256='.str_repeat('0', 64)] as $signature) {
            $body = json_encode($this->payload(), JSON_THROW_ON_ERROR);
            $server = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];
            if ($signature !== null) {
                $server['HTTP_X_HUB_SIGNATURE_256'] = $signature;
            }
            $this->call('POST', '/api/v1/whatsapp/webhook', [], [], [], $server, $body)->assertForbidden();
        }

        $this->assertDatabaseCount('whatsapp_webhook_events', 0);
        $this->assertNull($connection->fresh()->last_webhook_at);
    }

    public function test_missing_app_secret_is_rejected_even_with_a_signature(): void
    {
        config(['whatsapp.app_secret' => '']);
        $this->signed($this->payload())->assertForbidden();
        $this->assertDatabaseCount('whatsapp_webhook_events', 0);
    }

    public function test_signature_is_checked_against_the_exact_raw_body(): void
    {
        $body = json_encode($this->payload(), JSON_THROW_ON_ERROR);
        $this->call('POST', '/api/v1/whatsapp/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $body, 'webhook-test-secret'),
        ], $body.' ')->assertForbidden();
    }

    public function test_authenticated_malformed_json_is_rejected(): void
    {
        $body = '{invalid-json';
        $this->call('POST', '/api/v1/whatsapp/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $body, 'webhook-test-secret'),
        ], $body)->assertStatus(400);
        $this->assertDatabaseCount('whatsapp_webhook_events', 0);
    }

    public function test_signed_echo_is_encrypted_and_does_not_create_patients_or_send_messages(): void
    {
        $connection = $this->connection();
        $this->signed($this->payload())->assertOk();

        $event = WhatsAppWebhookEvent::sole();
        $this->assertSame('smb_message_echoes', $event->field);
        $this->assertSame('Sent from the Business app', $event->payload['message_echoes'][0]['text']['body']);
        $this->assertArrayNotHasKey('payload', $event->toArray());
        $this->assertStringNotContainsString('Sent from the Business app', DB::table('whatsapp_webhook_events')->value('payload'));
        $this->assertNotNull($connection->fresh()->last_webhook_at);
        $this->assertDatabaseCount('patients', 0);
        $this->assertDatabaseCount('whatsapp_messages', 0);
        Http::assertNothingSent();
    }

    public function test_events_without_a_current_connection_are_acknowledged_but_ignored(): void
    {
        $this->signed($this->payload())->assertOk();
        $this->assertDatabaseCount('whatsapp_webhook_events', 0);
        $this->assertDatabaseCount('whatsapp_connections', 0);
    }

    public function test_other_accounts_wrong_phone_numbers_unknown_fields_and_objects_are_ignored(): void
    {
        $connection = $this->connection();
        $this->signed($this->payload(wabaId: 'other-waba'))->assertOk();
        $this->signed($this->payload(value: ['metadata' => ['phone_number_id' => 'other-phone']]))->assertOk();
        $this->signed($this->payload(value: ['metadata' => ['phone_number_id' => null]]))->assertOk();
        $this->signed($this->payload('unsubscribed_field'))->assertOk();
        $payload = $this->payload();
        $payload['object'] = 'page';
        $this->signed($payload)->assertOk();

        $this->assertDatabaseCount('whatsapp_webhook_events', 0);
        $this->assertNull($connection->fresh()->last_webhook_at);
    }

    public function test_duplicate_changes_are_deduplicated_despite_object_key_order(): void
    {
        $connection = $this->connection();
        $payload = $this->payload();
        $this->signed($payload)->assertOk();
        $receivedAt = $connection->fresh()->last_webhook_at;

        $this->travel(2)->minutes();
        $payload['entry'][0]['time'] = now()->getTimestamp();
        $value = $payload['entry'][0]['changes'][0]['value'];
        $value['message_echoes'][0] = array_reverse($value['message_echoes'][0], true);
        $payload['entry'][0]['changes'][0]['value'] = array_reverse($value, true);
        $this->signed($payload)->assertOk();

        $this->assertDatabaseCount('whatsapp_webhook_events', 1);
        $this->assertTrue($receivedAt->equalTo($connection->fresh()->last_webhook_at));
    }

    public function test_history_progress_is_monotonic_and_completion_does_not_reactivate_a_connection(): void
    {
        $connection = $this->connection(['status' => 'disconnected']);
        foreach ([70, 30, 100, 80] as $progress) {
            $this->signed($this->payload('history', [
                'metadata' => ['phone_number_id' => 'phone-1'],
                'history' => [['metadata' => ['progress' => $progress], 'threads' => []]],
            ]))->assertOk();
            $this->assertGreaterThanOrEqual($progress, $connection->fresh()->sync_progress);
        }

        $this->assertSame(100, $connection->fresh()->sync_progress);
        $this->assertSame('complete', $connection->fresh()->history_status);
        $this->assertSame('disconnected', $connection->fresh()->status);
    }

    public function test_history_declined_error_is_recorded_without_importing_contacts(): void
    {
        $connection = $this->connection();
        $this->signed($this->payload('history', [
            'history' => [['errors' => [['code' => 2593109]]]],
        ]))->assertOk();

        $this->signed($this->payload('history', ['history' => [['metadata' => ['progress' => 50]]]]))->assertOk();
        $this->assertSame('declined', $connection->fresh()->history_status);
        $this->assertDatabaseCount('patients', 0);
    }

    public function test_removal_and_offboarding_disconnect_the_current_account(): void
    {
        $connection = $this->connection();
        foreach (['PARTNER_REMOVED', 'ACCOUNT_OFFBOARDED'] as $event) {
            $this->signed($this->payload('account_update', ['event' => $event]))->assertOk();
            $this->assertSame('disconnected', $connection->fresh()->status);
            $this->assertNotNull($connection->fresh()->disconnected_at);
            $this->assertSame(now()->getTimestamp(), $connection->fresh()->lifecycle_event_at->getTimestamp());
        }

        $this->signed($this->payload('account_update', ['event' => 'PARTNER_ADDED']))->assertOk();
        $this->assertSame('disconnected', $connection->fresh()->status);
    }

    public function test_older_and_timestamp_less_lifecycle_events_do_not_disconnect_a_new_connection(): void
    {
        $connection = $this->connection(['connected_at' => now(), 'lifecycle_event_at' => now()]);
        $payload = $this->payload('account_update', ['event' => 'PARTNER_REMOVED']);
        $payload['entry'][0]['time'] = now()->subHour()->getTimestamp();
        $this->signed($payload)->assertOk();

        $payload = $this->payload('account_update', ['event' => 'ACCOUNT_OFFBOARDED']);
        unset($payload['entry'][0]['time']);
        $this->signed($payload)->assertOk();

        $this->assertSame('connected', $connection->fresh()->status);
        $this->assertNull($connection->fresh()->disconnected_at);
        $this->assertDatabaseCount('whatsapp_webhook_events', 2);
    }

    public function test_lifecycle_ordering_handles_reconnects_and_repeated_removal_values(): void
    {
        $connection = $this->connection();
        $oldRemoval = $this->payload('account_update', ['event' => 'PARTNER_REMOVED']);
        $this->signed($oldRemoval)->assertOk();

        $this->travel(2)->minutes();
        $connection->refresh()->update([
            'status' => 'connected', 'connected_at' => now(), 'lifecycle_event_at' => now(), 'disconnected_at' => null,
        ]);
        $this->signed($oldRemoval)->assertOk();
        $this->assertSame('connected', $connection->fresh()->status);

        $this->travel(1)->minutes();
        $this->signed($this->payload('account_update', ['event' => 'PARTNER_REMOVED']))->assertOk();
        $this->assertSame('disconnected', $connection->fresh()->status);
        $disconnectedAt = $connection->fresh()->disconnected_at;

        $olderOffboarding = $this->payload('account_update', ['event' => 'ACCOUNT_OFFBOARDED']);
        $olderOffboarding['entry'][0]['time'] = now()->subSeconds(30)->getTimestamp();
        $this->signed($olderOffboarding)->assertOk();
        $this->assertTrue($disconnectedAt->equalTo($connection->fresh()->disconnected_at));
        $this->assertDatabaseCount('whatsapp_webhook_events', 2);
    }

    public function test_each_change_is_scoped_even_when_entries_mix_accounts_and_phone_numbers(): void
    {
        $this->connection();
        $payload = $this->payload();
        $wrongPhoneChange = $payload['entry'][0]['changes'][0];
        $wrongPhoneChange['value']['metadata']['phone_number_id'] = 'other-phone';
        $payload['entry'][0]['changes'][] = $wrongPhoneChange;
        $payload['entry'][] = $this->payload('history', ['history' => [['metadata' => ['progress' => 100]]]], 'other-waba')['entry'][0];

        $this->signed($payload)->assertOk();
        $this->assertDatabaseCount('whatsapp_webhook_events', 1);
        $this->assertSame(0, WhatsAppConnection::find(1)->sync_progress);
    }

    public function test_event_storage_and_state_updates_roll_back_together(): void
    {
        $connection = $this->connection();
        WhatsAppConnection::updating(function (): void {
            throw new \RuntimeException('State update failed.');
        });

        try {
            $this->signed($this->payload())->assertStatus(500);
            $this->assertDatabaseCount('whatsapp_webhook_events', 0);
            $this->assertNull($connection->fresh()->last_webhook_at);
        } finally {
            WhatsAppConnection::flushEventListeners();
        }
    }

    public function test_events_are_admin_only(): void
    {
        $this->getJson('/api/v1/whatsapp/coexistence/events')->assertUnauthorized();
        foreach (['receptionist', 'doctor', 'patient'] as $role) {
            $user = User::factory()->create(['role' => $role]);
            $this->actingAs($user, 'sanctum')->getJson('/api/v1/whatsapp/coexistence/events')->assertForbidden();
        }
    }

    public function test_admin_events_expose_capped_message_summaries_and_counts_not_raw_contacts(): void
    {
        $this->connection();
        $messages = array_fill(0, 55, [
            'from' => '15550000002', 'type' => 'text', 'text' => ['body' => 'Historical message'],
        ]);
        $this->signed($this->payload('history', ['history' => [[
            'metadata' => ['progress' => 100],
            'threads' => [['id' => '15550000002', 'messages' => $messages]],
        ]]]))->assertOk();
        $this->signed($this->payload('smb_app_state_sync', [
            'state_sync' => [['type' => 'contact', 'action' => 'add', 'contact' => ['full_name' => 'Private contact', 'phone_number' => '15550000002']]],
        ]))->assertOk();
        $admin = User::factory()->create(['role' => 'admin']);

        $response = $this->actingAs($admin, 'sanctum')->getJson('/api/v1/whatsapp/coexistence/events?per_page=2')
            ->assertOk()->assertJsonPath('data.total', 2)
            ->assertJsonPath('data.data.0.contact_count', 1)
            ->assertJsonPath('data.data.1.message_count', 55)
            ->assertJsonCount(50, 'data.data.1.messages')
            ->assertJsonPath('data.data.1.messages.0.direction', 'incoming')
            ->assertJsonPath('data.data.1.messages.0.peer_number', '15550000002')
            ->assertJsonPath('data.data.1.messages.0.body', 'Historical message');

        $this->assertStringNotContainsString('Private contact', $response->getContent());
        $this->assertArrayNotHasKey('payload', $response->json('data.data.0'));
        $this->assertArrayNotHasKey('fingerprint', $response->json('data.data.0'));
    }

    public function test_admin_event_summaries_include_all_echoes_and_incoming_messages(): void
    {
        $this->connection();
        $payload = $this->payload();
        $payload['entry'][0]['changes'][0]['value']['message_echoes'][] = [
            'to' => '15550000003', 'type' => 'image',
        ];
        $this->signed($payload)->assertOk();
        $this->signed($this->payload('messages', ['messages' => [[
            'from' => '15550000004', 'type' => 'text', 'text' => ['body' => 'Incoming message'],
        ]]]))->assertOk();
        $admin = User::factory()->create(['role' => 'admin']);

        $this->actingAs($admin, 'sanctum')->getJson('/api/v1/whatsapp/coexistence/events')->assertOk()
            ->assertJsonPath('data.data.0.messages.0.direction', 'incoming')
            ->assertJsonPath('data.data.0.messages.0.peer_number', '15550000004')
            ->assertJsonPath('data.data.1.message_count', 2)
            ->assertJsonPath('data.data.1.messages.0.direction', 'outgoing')
            ->assertJsonPath('data.data.1.messages.1.peer_number', '15550000003')
            ->assertJsonPath('data.data.1.messages.1.body', null);
    }
}
