<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\WhatsAppConnection;
use App\Support\WhatsAppSender;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class WhatsAppSenderTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'whatsapp.phone_number_id' => null,
            'whatsapp.access_token' => null,
            'whatsapp.business_account_id' => null,
            'whatsapp.phone_number' => null,
        ]);
    }

    private function connect(array $attributes = []): WhatsAppConnection
    {
        return WhatsAppConnection::create(array_merge([
            'id' => 1, 'waba_id' => '100', 'phone_number_id' => '777',
            'display_phone_number' => '+919876543210', 'token' => 'coexistence-token',
            'status' => 'connected', 'connected_at' => now(),
        ], $attributes));
    }

    public function test_without_any_account_no_sender_is_resolved(): void
    {
        $this->assertNull(WhatsAppSender::resolve());
        $this->assertSame(['source' => null, 'phone_number' => null, 'coexistence_connected' => false], WhatsAppSender::describe());
    }

    public function test_the_standard_number_is_used_when_coexistence_is_not_configured(): void
    {
        config([
            'whatsapp.phone_number_id' => '555',
            'whatsapp.access_token' => 'standard-token',
            'whatsapp.business_account_id' => '100',
            'whatsapp.phone_number' => '+91 90000 00000',
        ]);

        $sender = WhatsAppSender::resolve();
        $this->assertSame('standard', $sender['source']);
        $this->assertSame('555', $sender['phone_number_id']);
        $this->assertSame('standard-token', $sender['token']);
        $this->assertSame('100', $sender['waba_id']);
        $this->assertSame('+91 90000 00000', $sender['phone_number']);
    }

    public function test_a_connected_business_app_number_wins_over_the_standard_number(): void
    {
        config(['whatsapp.phone_number_id' => '555', 'whatsapp.access_token' => 'standard-token']);
        $this->connect();

        $sender = WhatsAppSender::resolve();
        $this->assertSame('coexistence', $sender['source']);
        $this->assertSame('777', $sender['phone_number_id']);
        $this->assertSame('coexistence-token', $sender['token']);
        $this->assertSame('+919876543210', $sender['phone_number']);
    }

    public function test_a_disconnected_business_app_number_falls_back_to_the_standard_number(): void
    {
        config(['whatsapp.phone_number_id' => '555', 'whatsapp.access_token' => 'standard-token']);
        $this->connect(['status' => 'disconnected', 'disconnected_at' => now()]);

        $sender = WhatsAppSender::resolve();
        $this->assertSame('standard', $sender['source']);
        $this->assertSame('555', $sender['phone_number_id']);
    }

    public function test_a_connection_still_being_set_up_is_not_used_for_sending(): void
    {
        $this->connect(['status' => 'connecting']);
        $this->assertNull(WhatsAppSender::resolve());
    }

    public function test_staff_can_read_the_active_sender_without_admin_rights(): void
    {
        $receptionist = User::factory()->create(['role' => 'receptionist']);
        $token = $receptionist->createToken('test')->plainTextToken;

        $this->withToken($token)
            ->getJson('/api/v1/whatsapp/sender')
            ->assertOk()
            ->assertJsonPath('data.source', null)
            ->assertJsonPath('data.country_code', '91');

        config(['whatsapp.phone_number_id' => '555', 'whatsapp.access_token' => 'standard-token']);
        $this->withToken($token)
            ->getJson('/api/v1/whatsapp/sender')
            ->assertOk()
            ->assertJsonPath('data.source', 'standard');

        $this->connect();
        $this->withToken($token)
            ->getJson('/api/v1/whatsapp/sender')
            ->assertOk()
            ->assertJsonPath('data.source', 'coexistence')
            ->assertJsonPath('data.coexistence_connected', true);

        $this->actingAs(User::factory()->create(['role' => 'patient']), 'sanctum')
            ->getJson('/api/v1/whatsapp/sender')
            ->assertForbidden();
    }

    public function test_the_status_endpoint_reports_the_active_sender(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $token = $admin->createToken('test')->plainTextToken;

        $this->withToken($token)
            ->getJson('/api/v1/whatsapp/status')
            ->assertOk()
            ->assertJsonPath('data.configured', false)
            ->assertJsonPath('data.sender.source', null);

        config(['whatsapp.phone_number_id' => '555', 'whatsapp.access_token' => 'standard-token', 'whatsapp.phone_number' => '+91 90000 00000']);
        $this->withToken($token)
            ->getJson('/api/v1/whatsapp/status')
            ->assertOk()
            ->assertJsonPath('data.configured', true)
            ->assertJsonPath('data.sender.source', 'standard')
            ->assertJsonPath('data.sender.phone_number', '+91 90000 00000');

        $this->connect();
        $this->withToken($token)
            ->getJson('/api/v1/whatsapp/status')
            ->assertOk()
            ->assertJsonPath('data.sender.source', 'coexistence')
            ->assertJsonPath('data.sender.coexistence_connected', true);
    }
}
