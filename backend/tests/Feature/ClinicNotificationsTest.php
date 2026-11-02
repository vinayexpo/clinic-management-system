<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Doctor;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\User;
use App\Models\Visit;
use App\Notifications\ClinicNotification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class ClinicNotificationsTest extends TestCase
{
    use RefreshDatabase;

    private function token(User $user): string
    {
        return $user->createToken('test')->plainTextToken;
    }

    /**
     * Authenticate as a specific user. The auth guard caches the resolved user for the
     * lifetime of the test application, so it is reset between identities.
     */
    private function asUser(User $user): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($this->token($user));
    }

    private function doctorWithUser(): array
    {
        $user = User::factory()->create(['role' => 'doctor']);
        $doctor = Doctor::create(['user_id' => $user->id, 'display_name' => 'Dr Notify', 'consultation_fee' => 500, 'is_active' => true]);

        return [$user, $doctor];
    }

    private function patientWithUser(): array
    {
        $user = User::factory()->create(['role' => 'patient', 'phone' => '9800000001']);
        $patient = Patient::create(['user_id' => $user->id, 'patient_number' => 'PAT-N1', 'first_name' => 'Nisha', 'phone' => '9800000001', 'created_by' => $user->id]);

        return [$user, $patient];
    }

    public function test_booking_an_appointment_notifies_the_doctor_and_the_patient(): void
    {
        Notification::fake();
        $receptionist = User::factory()->create(['role' => 'receptionist']);
        [$doctorUser, $doctor] = $this->doctorWithUser();
        [$patientUser, $patient] = $this->patientWithUser();

        $this->withToken($this->token($receptionist))->postJson('/api/v1/appointments', [
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'appointment_date' => today()->toDateString(),
            'start_time' => '10:00',
            'end_time' => '10:30',
            'reason_for_visit' => 'Follow up',
        ])->assertCreated();

        Notification::assertSentTo($doctorUser, ClinicNotification::class, function (ClinicNotification $notification) {
            return $notification->type === 'appointment.booked' && $notification->page === 'Appointments';
        });
        Notification::assertSentTo($patientUser, ClinicNotification::class, function (ClinicNotification $notification) {
            return $notification->type === 'appointment.booked';
        });
    }

    public function test_cancelling_an_appointment_notifies_both_parties_with_the_reason(): void
    {
        Notification::fake();
        $receptionist = User::factory()->create(['role' => 'receptionist']);
        [$doctorUser, $doctor] = $this->doctorWithUser();
        [$patientUser, $patient] = $this->patientWithUser();
        $appointment = Appointment::create([
            'appointment_number' => 'APT-N1', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id,
            'appointment_date' => today(), 'start_time' => '11:00', 'visit_type' => 'appointment',
            'status' => 'booked', 'token_number' => 1, 'created_by' => $receptionist->id,
        ]);

        $this->withToken($this->token($receptionist))
            ->postJson("/api/v1/appointments/{$appointment->id}/cancel", ['cancel_reason' => 'Patient rescheduled'])
            ->assertOk();

        Notification::assertSentTo($doctorUser, ClinicNotification::class, fn (ClinicNotification $n) => $n->type === 'appointment.cancelled' && str_contains($n->body, 'Patient rescheduled'));
        Notification::assertSentTo($patientUser, ClinicNotification::class, fn (ClinicNotification $n) => $n->type === 'appointment.cancelled');
    }

    public function test_finalizing_a_visit_notifies_the_patient_and_front_desk(): void
    {
        Notification::fake();
        $admin = User::factory()->create(['role' => 'admin']);
        [$doctorUser, $doctor] = $this->doctorWithUser();
        [$patientUser, $patient] = $this->patientWithUser();
        $visit = Visit::create([
            'visit_number' => 'VIS-N1', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id,
            'visit_date' => today(), 'status' => 'draft', 'diagnosis' => 'Seasonal allergy', 'created_by' => $admin->id,
        ]);

        $this->withToken($this->token($doctorUser))->postJson("/api/v1/visits/{$visit->id}/finalize")->assertOk();

        Notification::assertSentTo($patientUser, ClinicNotification::class, fn (ClinicNotification $n) => $n->type === 'visit.finalized');
        Notification::assertSentTo($admin, ClinicNotification::class, fn (ClinicNotification $n) => $n->type === 'visit.finalized');
    }

    public function test_finalizing_a_prescription_notifies_the_patient(): void
    {
        Notification::fake();
        $admin = User::factory()->create(['role' => 'admin']);
        [$doctorUser, $doctor] = $this->doctorWithUser();
        [$patientUser, $patient] = $this->patientWithUser();
        $visit = Visit::create(['visit_number' => 'VIS-N2', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'visit_date' => today(), 'status' => 'finalized', 'created_by' => $admin->id]);
        $prescription = Prescription::create(['prescription_number' => 'RX-N1', 'visit_id' => $visit->id, 'patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'status' => 'draft']);

        $this->withToken($this->token($doctorUser))->postJson("/api/v1/prescriptions/{$prescription->id}/finalize")->assertOk();

        Notification::assertSentTo($patientUser, ClinicNotification::class, fn (ClinicNotification $n) => $n->type === 'prescription.finalized');
    }

    public function test_recording_a_payment_notifies_the_patient_and_administrators(): void
    {
        Notification::fake();
        $admin = User::factory()->create(['role' => 'admin']);
        $receptionist = User::factory()->create(['role' => 'receptionist']);
        [$patientUser, $patient] = $this->patientWithUser();
        $invoice = Invoice::create([
            'invoice_number' => 'INV-N1', 'patient_id' => $patient->id, 'invoice_date' => today(),
            'subtotal' => 500, 'discount_amount' => 0, 'total_amount' => 500, 'status' => 'unpaid', 'created_by' => $admin->id,
        ]);

        $this->withToken($this->token($receptionist))->postJson("/api/v1/invoices/{$invoice->id}/payments", [
            'amount' => 500, 'payment_method' => 'cash',
        ])->assertCreated();

        Notification::assertSentTo($patientUser, ClinicNotification::class, fn (ClinicNotification $n) => $n->type === 'invoice.paid');
        Notification::assertSentTo($admin, ClinicNotification::class, fn (ClinicNotification $n) => $n->type === 'invoice.paid');
    }

    public function test_notifications_are_stored_and_listed_for_the_owner_only(): void
    {
        $owner = User::factory()->create(['role' => 'receptionist']);
        $other = User::factory()->create(['role' => 'receptionist']);
        $owner->notify(new ClinicNotification('Appointment booked', 'A visit was booked.', 'appointment.booked', 'Appointments', 12));

        $this->asUser($owner)->getJson('/api/v1/notifications')
            ->assertOk()->assertJsonCount(1, 'data.data')->assertJsonPath('data.data.0.title', 'Appointment booked');

        $this->asUser($other)->getJson('/api/v1/notifications')->assertOk()->assertJsonCount(0, 'data.data');
    }

    public function test_a_user_cannot_mark_another_users_notification_as_read(): void
    {
        $owner = User::factory()->create(['role' => 'receptionist']);
        $other = User::factory()->create(['role' => 'receptionist']);
        $owner->notify(new ClinicNotification('Private', 'Only for the owner.', 'general'));

        $notificationId = $owner->notifications()->first()->id;

        $this->asUser($other)->postJson("/api/v1/notifications/{$notificationId}/read")->assertNotFound();
    }

    public function test_marking_notifications_as_read_updates_the_unread_count(): void
    {
        $user = User::factory()->create(['role' => 'receptionist']);
        $user->notify(new ClinicNotification('One', 'First.', 'general'));
        $user->notify(new ClinicNotification('Two', 'Second.', 'general'));

        $this->withToken($this->token($user))->getJson('/api/v1/notifications/unread-count')->assertOk()->assertJsonPath('data.unread', 2);

        $this->withToken($this->token($user))->postJson('/api/v1/notifications/read-all')->assertOk()->assertJsonPath('data.unread', 0);
        $this->withToken($this->token($user))->getJson('/api/v1/notifications/unread-count')->assertOk()->assertJsonPath('data.unread', 0);
    }

    public function test_a_push_subscription_can_be_stored_and_removed(): void
    {
        $user = User::factory()->create(['role' => 'receptionist']);
        $endpoint = 'https://push.example.test/subscription/abc123';

        $this->withToken($this->token($user))->getJson('/api/v1/notifications/push/key')
            ->assertOk()->assertJsonPath('data.enabled', true)->assertJsonPath('data.subscribed', false);

        $this->withToken($this->token($user))->postJson('/api/v1/notifications/push/subscribe', [
            'endpoint' => $endpoint,
            'keys' => ['p256dh' => 'public-key-value', 'auth' => 'auth-token-value'],
            'content_encoding' => 'aes128gcm',
        ])->assertOk()->assertJsonPath('data.subscribed', true);

        $this->assertDatabaseHas('push_subscriptions', ['endpoint' => $endpoint, 'subscribable_id' => $user->id, 'subscribable_type' => User::class]);

        $this->withToken($this->token($user))->postJson('/api/v1/notifications/push/unsubscribe', ['endpoint' => $endpoint])->assertOk();
        $this->assertDatabaseMissing('push_subscriptions', ['endpoint' => $endpoint]);
    }

    public function test_patient_notifications_are_not_delivered_to_staff_and_vice_versa(): void
    {
        Notification::fake();
        $admin = User::factory()->create(['role' => 'admin']);
        [$doctorUser, $doctor] = $this->doctorWithUser();
        [$patientUser, $patient] = $this->patientWithUser();

        $appointment = Appointment::create([
            'appointment_number' => 'APT-N2', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id,
            'appointment_date' => today(), 'start_time' => '09:00', 'visit_type' => 'appointment',
            'status' => 'booked', 'token_number' => 1, 'created_by' => $admin->id,
        ]);

        $this->withToken($this->token($admin))->postJson("/api/v1/appointments/{$appointment->id}/cancel", ['cancel_reason' => 'Clinic closed'])->assertOk();

        Notification::assertNotSentTo($admin, ClinicNotification::class);
        Notification::assertSentTo($doctorUser, ClinicNotification::class);
        Notification::assertSentTo($patientUser, ClinicNotification::class);
    }
}
