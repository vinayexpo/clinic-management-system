<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\User;
use App\Models\WhatsAppMessage;
use App\Models\WhatsAppMetaTemplate;
use App\Models\WhatsAppTemplate;
use App\Support\Phone;
use App\Support\WhatsAppDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class WhatsAppReminderTest extends TestCase
{
    use RefreshDatabase;

    private function doctor(): Doctor
    {
        $user = User::factory()->create(['role' => 'doctor']);

        return Doctor::create(['user_id' => $user->id, 'display_name' => 'Dr Mehta', 'consultation_fee' => 500, 'is_active' => true]);
    }

    /** Live sends now require wording confirmed against an approved Meta template. */
    private function approveReminderTemplate(): void
    {
        config(['whatsapp.business_account_id' => '100']);
        app(WhatsAppDispatcher::class)->template('appointment_reminder');
        WhatsAppTemplate::query()->where('event', 'appointment_reminder')->update([
            'body' => 'Reminder: {{patient_name}}.',
            'language' => 'en',
            'category' => 'UTILITY',
            'meta_template_id' => '9001',
            'bindings' => [['key' => '1', 'variable' => 'patient_name']],
            'sync_state' => 'synced',
            'baseline_hash' => 'remote-baseline',
            'baseline_local_hash' => 'local-baseline',
        ]);

        WhatsAppMetaTemplate::query()->create([
            'waba_id' => '100', 'meta_template_id' => '9001',
            'name' => 'carehaven_appointment_reminder', 'language' => 'en',
            'category' => 'UTILITY', 'status' => 'APPROVED', 'parameter_format' => 'POSITIONAL',
            'components' => [['type' => 'BODY', 'text' => 'Reminder: {{1}}.']],
            'body' => 'Reminder: {{1}}.', 'placeholders' => ['1'],
            'supported' => true, 'remote_hash' => 'remote-baseline', 'missing' => false,
            'last_synced_at' => now(),
        ]);
    }

    private function patient(array $attributes = []): Patient
    {
        return Patient::create(array_merge([
            'patient_number' => 'PAT-WA-'.uniqid(),
            'first_name' => 'Asha',
            'last_name' => 'Verma',
            'phone' => '9876543210',
            'whatsapp_opt_in' => true,
        ], $attributes));
    }

    private function appointment(Patient $patient, Doctor $doctor, array $attributes = []): Appointment
    {
        return Appointment::create(array_merge([
            'appointment_number' => 'APT-'.uniqid(),
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'appointment_date' => today(),
            'start_time' => '10:00',
            'visit_type' => 'appointment',
            'status' => 'booked',
            'token_number' => 1,
        ], $attributes));
    }

    public function test_template_body_is_rendered_and_parameters_are_collected_in_order(): void
    {
        $dispatcher = app(WhatsAppDispatcher::class);

        [$body, $parameters] = $dispatcher->render(
            'Hello {{patient_name}}, your appointment with {{doctor_name}} is on {{appointment_date}} at {{appointment_time}}.',
            ['patient_name' => 'Asha', 'doctor_name' => 'Dr Mehta', 'appointment_date' => '21 Oct 2026', 'appointment_time' => '10:30'],
        );

        $this->assertSame('Hello Asha, your appointment with Dr Mehta is on 21 Oct 2026 at 10:30.', $body);
        $this->assertSame(['Asha', 'Dr Mehta', '21 Oct 2026', '10:30'], $parameters);
    }

    public function test_phone_numbers_are_converted_to_e164(): void
    {
        $this->assertSame('+919876543210', Phone::toE164('9876543210'));
        $this->assertSame('+919876543210', Phone::toE164('+91 98765 43210'));
        $this->assertSame('+919876543210', Phone::toE164('098765-43210'));
        $this->assertNull(Phone::toE164('123'));
    }

    public function test_no_message_is_sent_when_whatsapp_is_disabled(): void
    {
        config(['whatsapp.enabled' => false]);
        $patient = $this->patient();
        $doctor = $this->doctor();
        $appointment = $this->appointment($patient, $doctor);

        $result = app(WhatsAppDispatcher::class)->send($patient, 'appointment_reminder', ['patient_name' => 'Asha'], $appointment);

        $this->assertSame('skipped', $result['status']);
        $this->assertSame(0, WhatsAppMessage::count());
    }

    public function test_patient_without_consent_is_not_messaged(): void
    {
        config(['whatsapp.enabled' => true, 'whatsapp.log_only' => true]);
        $patient = $this->patient(['whatsapp_opt_in' => false]);
        $doctor = $this->doctor();
        $appointment = $this->appointment($patient, $doctor);

        $result = app(WhatsAppDispatcher::class)->send($patient, 'appointment_reminder', ['patient_name' => 'Asha'], $appointment);

        $this->assertSame('skipped', $result['status']);
        $this->assertSame(0, WhatsAppMessage::count());
    }

    public function test_message_is_logged_with_the_rendered_body(): void
    {
        config(['whatsapp.enabled' => true, 'whatsapp.log_only' => true]);
        $patient = $this->patient();
        $doctor = $this->doctor();
        $appointment = $this->appointment($patient, $doctor);

        $result = app(WhatsAppDispatcher::class)->send(
            $patient,
            'appointment_reminder',
            ['patient_name' => 'Asha Verma', 'doctor_name' => 'Dr Mehta', 'appointment_date' => '21 Oct 2026', 'appointment_time' => '10:00'],
            $appointment,
        );

        $this->assertSame('logged', $result['status']);
        $message = WhatsAppMessage::first();
        $this->assertNotNull($message);
        $this->assertSame('logged', $message->status);
        $this->assertSame('+919876543210', $message->to_number);
        $this->assertStringContainsString('Asha Verma', $message->rendered_body);
        $this->assertSame($patient->id, $message->patient_id);
    }

    public function test_reminder_command_sends_once_and_never_repeats(): void
    {
        config(['whatsapp.enabled' => true, 'whatsapp.log_only' => true, 'whatsapp.reminder_lead_hours' => 24]);
        $patient = $this->patient();
        $doctor = $this->doctor();
        $appointment = $this->appointment($patient, $doctor, ['appointment_date' => today(), 'start_time' => date('H:i', strtotime('+3 hours'))]);

        $this->artisan('clinic:whatsapp-reminders')->assertSuccessful();
        $this->assertSame(1, WhatsAppMessage::count());
        $this->assertNotNull($appointment->fresh()->reminder_sent_at);

        // Running again must not message the patient twice.
        $this->artisan('clinic:whatsapp-reminders')->assertSuccessful();
        $this->assertSame(1, WhatsAppMessage::count());
    }

    public function test_reminder_command_skips_appointments_outside_doctor_hours(): void
    {
        config(['whatsapp.enabled' => true, 'whatsapp.log_only' => true, 'whatsapp.respect_doctor_schedule' => true]);
        $patient = $this->patient();
        $doctor = $this->doctor();
        // The doctor works 09:00-13:00; the appointment is at 18:00.
        $doctor->schedules()->create(['day_of_week' => (int) date('w'), 'start_time' => '09:00', 'end_time' => '13:00', 'is_active' => true]);
        $appointment = $this->appointment($patient, $doctor, ['appointment_date' => today(), 'start_time' => '18:00']);

        $this->artisan('clinic:whatsapp-reminders')->assertSuccessful();

        $this->assertSame(0, WhatsAppMessage::count());
        $this->assertNull($appointment->fresh()->reminder_sent_at);
    }

    public function test_graph_api_request_is_made_with_template_parameters(): void
    {
        config(['whatsapp.enabled' => true, 'whatsapp.log_only' => false, 'whatsapp.phone_number_id' => '123456', 'whatsapp.access_token' => 'token-abc']);
        $this->approveReminderTemplate();
        Http::fake(['graph.facebook.com/*' => Http::response(['messages' => [['id' => 'wamid.123']]], 200)]);

        $patient = $this->patient();
        $doctor = $this->doctor();
        $appointment = $this->appointment($patient, $doctor);

        $result = app(WhatsAppDispatcher::class)->send($patient, 'appointment_reminder', ['patient_name' => 'Asha'], $appointment);

        $this->assertSame('sent', $result['status']);
        $this->assertSame('wamid.123', $result['message']->provider_message_id);

        Http::assertSent(function ($request): bool {
            $body = $request->data();
            $this->assertSame('whatsapp', $body['messaging_product']);
            $this->assertSame('template', $body['type']);
            $this->assertSame('+919876543210', $body['to']);
            $this->assertSame('carehaven_appointment_reminder', $body['template']['name']);
            $this->assertSame('Asha', $body['template']['components'][0]['parameters'][0]['text']);

            return true;
        });
    }

    public function test_failed_send_is_recorded_with_the_error(): void
    {
        config(['whatsapp.enabled' => true, 'whatsapp.log_only' => false, 'whatsapp.phone_number_id' => '123456', 'whatsapp.access_token' => 'token-abc']);
        $this->approveReminderTemplate();
        Http::fake(['graph.facebook.com/*' => Http::response(['error' => ['message' => 'Invalid template name']], 400)]);

        $patient = $this->patient();
        $doctor = $this->doctor();
        $appointment = $this->appointment($patient, $doctor);

        $result = app(WhatsAppDispatcher::class)->send($patient, 'appointment_reminder', ['patient_name' => 'Asha'], $appointment);

        $this->assertSame('failed', $result['status']);
        $this->assertSame('Invalid template name', $result['error']);
        $this->assertSame('failed', WhatsAppMessage::first()->status);
    }

    public function test_only_admin_can_manage_whatsapp_settings(): void
    {
        $receptionist = User::factory()->create(['role' => 'receptionist']);

        $this->withToken($receptionist->createToken('t')->plainTextToken)->getJson('/api/v1/whatsapp/status')->assertForbidden();
        $this->withToken($receptionist->createToken('t')->plainTextToken)->putJson('/api/v1/whatsapp/templates/manual', [
            'template_name' => 'x', 'body' => 'y',
        ])->assertForbidden();
    }

    public function test_consent_can_be_set_by_reception(): void
    {
        $receptionist = User::factory()->create(['role' => 'receptionist']);
        $patient = $this->patient(['whatsapp_opt_in' => false]);

        $this->withToken($receptionist->createToken('t')->plainTextToken)
            ->putJson("/api/v1/patients/{$patient->id}/whatsapp-consent", ['whatsapp_opt_in' => true])
            ->assertOk()
            ->assertJsonPath('data.whatsapp_opt_in', true);

        $this->assertTrue($patient->fresh()->whatsapp_opt_in);
    }
}
