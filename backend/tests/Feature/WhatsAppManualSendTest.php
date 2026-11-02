<?php

namespace Tests\Feature;

use App\Models\Patient;
use App\Models\User;
use App\Models\WhatsAppMessage;
use App\Models\WhatsAppMetaTemplate;
use App\Models\WhatsAppTemplate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class WhatsAppManualSendTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'whatsapp.enabled' => true,
            'whatsapp.log_only' => false,
            'whatsapp.phone_number_id' => '555',
            'whatsapp.access_token' => 'standard-token',
            'whatsapp.business_account_id' => '100',
            'whatsapp.graph_version' => 'v26.0',
            'whatsapp.api_base' => 'https://graph.facebook.com',
        ]);
        Http::preventStrayRequests();
    }

    private function patient(array $attributes = []): Patient
    {
        $admin = User::factory()->create(['role' => 'admin']);

        return Patient::create(array_merge([
            'patient_number' => 'PAT-MANUAL-1', 'first_name' => 'Asha', 'last_name' => 'Verma',
            'phone' => '9876543210', 'whatsapp_opt_in' => true, 'created_by' => $admin->id,
        ], $attributes));
    }

    private function approveManualTemplate(): void
    {
        WhatsAppTemplate::create([
            'event' => 'manual', 'template_name' => 'carehaven_manual_message',
            'body' => 'Hello {{patient_name}}, a message from {{clinic_name}}: {{message}}',
            'is_active' => true,
            'language' => 'en', 'category' => 'UTILITY',
            'meta_template_id' => '9001',
            'bindings' => [['key' => '1', 'variable' => 'patient_name'], ['key' => '2', 'variable' => 'clinic_name'], ['key' => '3', 'variable' => 'message']],
            'sync_state' => 'synced', 'baseline_hash' => 'remote', 'baseline_local_hash' => 'local',
        ]);

        WhatsAppMetaTemplate::create([
            'waba_id' => '100', 'meta_template_id' => '9001', 'name' => 'carehaven_manual_message',
            'language' => 'en', 'category' => 'UTILITY', 'status' => 'APPROVED',
            'parameter_format' => 'POSITIONAL',
            'components' => [['type' => 'BODY', 'text' => 'Hello {{1}}, a message from {{2}}: {{3}}']],
            'body' => 'Hello {{1}}, a message from {{2}}: {{3}}', 'placeholders' => ['1', '2', '3'],
            'supported' => true, 'remote_hash' => 'remote', 'missing' => false, 'last_synced_at' => now(),
        ]);
    }

    public function test_staff_can_send_a_manual_message_to_an_opted_in_patient(): void
    {
        $this->approveManualTemplate();
        $patient = $this->patient();
        Http::fake(['*/555/messages' => Http::response(['messages' => [['id' => 'wamid.manual']]], 200)]);
        $this->actingAs(User::factory()->create(['role' => 'receptionist']), 'sanctum');

        $this->postJson('/api/v1/whatsapp/send', ['patient_id' => $patient->id, 'message' => 'Your report is ready.'])
            ->assertOk()
            ->assertJsonPath('data.status', 'sent');

        $message = WhatsAppMessage::where('patient_id', $patient->id)->latest('id')->first();
        $this->assertSame('manual', $message->event);
        $this->assertSame('sent', $message->status);
        $this->assertStringContainsString('Your report is ready.', $message->rendered_body);
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/555/messages'));
    }

    public function test_a_patient_without_consent_cannot_be_messaged(): void
    {
        $this->approveManualTemplate();
        $patient = $this->patient(['whatsapp_opt_in' => false]);
        $this->actingAs(User::factory()->create(['role' => 'admin']), 'sanctum');

        $this->postJson('/api/v1/whatsapp/send', ['patient_id' => $patient->id, 'message' => 'Hello'])
            ->assertUnprocessable();
        Http::assertNothingSent();
        $this->assertSame(0, WhatsAppMessage::count());
    }

    public function test_a_patient_without_a_usable_phone_number_cannot_be_messaged(): void
    {
        $this->approveManualTemplate();
        $patient = $this->patient(['phone' => 'not-a-number']);
        $this->actingAs(User::factory()->create(['role' => 'admin']), 'sanctum');

        $this->postJson('/api/v1/whatsapp/send', ['patient_id' => $patient->id, 'message' => 'Hello'])
            ->assertUnprocessable();
    }

    public function test_patients_cannot_send_messages(): void
    {
        $patient = $this->patient();
        $this->actingAs(User::factory()->create(['role' => 'patient']), 'sanctum');

        $this->postJson('/api/v1/whatsapp/send', ['patient_id' => $patient->id, 'message' => 'Hello'])
            ->assertForbidden();
    }

    public function test_the_message_is_required(): void
    {
        $patient = $this->patient();
        $this->actingAs(User::factory()->create(['role' => 'admin']), 'sanctum');

        $this->postJson('/api/v1/whatsapp/send', ['patient_id' => $patient->id, 'message' => '   '])
            ->assertUnprocessable();
        $this->postJson('/api/v1/whatsapp/send', ['patient_id' => 99999, 'message' => 'Hello'])
            ->assertNotFound();
    }

    public function test_a_provider_failure_is_reported_back(): void
    {
        $this->approveManualTemplate();
        $patient = $this->patient();
        Http::fake(['*/555/messages' => Http::response(['error' => ['message' => 'Template not approved']], 400)]);
        $this->actingAs(User::factory()->create(['role' => 'admin']), 'sanctum');

        $this->postJson('/api/v1/whatsapp/send', ['patient_id' => $patient->id, 'message' => 'Hello'])
            ->assertOk()
            ->assertJsonPath('data.status', 'failed')
            ->assertJsonPath('data.error', 'Template not approved');

        $this->assertSame('failed', WhatsAppMessage::where('patient_id', $patient->id)->latest('id')->first()->status);
    }

    public function test_log_only_mode_records_the_message_without_sending(): void
    {
        config(['whatsapp.log_only' => true]);
        $this->approveManualTemplate();
        $patient = $this->patient();
        $this->actingAs(User::factory()->create(['role' => 'admin']), 'sanctum');

        $this->postJson('/api/v1/whatsapp/send', ['patient_id' => $patient->id, 'message' => 'Your report is ready.'])
            ->assertOk()
            ->assertJsonPath('data.status', 'logged');

        Http::assertNothingSent();
        $this->assertSame('logged', WhatsAppMessage::where('patient_id', $patient->id)->latest('id')->first()->status);
    }
}
