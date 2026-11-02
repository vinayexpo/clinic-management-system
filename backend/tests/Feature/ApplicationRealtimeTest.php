<?php

namespace Tests\Feature;

use App\Events\ApplicationInvalidated;
use App\Models\AiSetting;
use App\Models\Appointment;
use App\Models\AuditLog;
use App\Models\ClinicSetting;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Patient;
use App\Models\Payment;
use App\Models\Prescription;
use App\Models\PrescriptionItem;
use App\Models\User;
use App\Models\Visit;
use App\Models\VisitAmendment;
use App\Models\WhatsAppConnection;
use App\Models\WhatsAppMessage;
use App\Models\WhatsAppMetaTemplate;
use App\Models\WhatsAppTemplate;
use App\Models\WhatsAppWebhookEvent;
use Illuminate\Contracts\Broadcasting\Factory;
use Illuminate\Foundation\Testing\DatabaseTruncation;
use Illuminate\Foundation\Testing\RefreshDatabaseState;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Mockery;
use PHPUnit\Framework\Attributes\TestWith;
use Pusher\Pusher;
use RuntimeException;
use Tests\TestCase;

class ApplicationRealtimeTest extends TestCase
{
    use DatabaseTruncation;

    protected function beforeTruncatingDatabase(): void
    {
        // These tests need real commits, not the test harness's enclosing transaction.
        RefreshDatabaseState::$migrated = false;
        $this->beforeApplicationDestroyed(function (): void {
            RefreshDatabaseState::$migrated = false;
        });
    }

    private function channels(ApplicationInvalidated $event): array
    {
        return array_map(fn ($channel) => $channel->name, $event->broadcastOn());
    }

    private function configureAuth(): void
    {
        config(['broadcasting.default' => 'reverb', 'broadcasting.connections.reverb.key' => 'test-key',
            'broadcasting.connections.reverb.secret' => 'test-secret', 'broadcasting.connections.reverb.app_id' => 'test']);
        require base_path('routes/channels.php');
    }

    public function test_broadcast_auth_requires_a_valid_bearer_token(): void
    {
        $this->postJson('/api/broadcasting/auth', ['channel_name' => 'private-users.1', 'socket_id' => '1.2'])->assertUnauthorized();
        $this->withToken('invalid')->postJson('/api/broadcasting/auth', ['channel_name' => 'private-users.1', 'socket_id' => '1.2'])->assertUnauthorized();
    }

    #[TestWith(['admin'])]
    #[TestWith(['doctor'])]
    #[TestWith(['receptionist'])]
    #[TestWith(['patient'])]
    public function test_each_role_can_only_authorize_its_own_private_channel(string $role): void
    {
        $user = User::factory()->create(['role' => $role]);
        $other = User::factory()->create(['role' => 'patient']);
        $token = $user->createToken('test')->plainTextToken;
        $this->configureAuth();

        $this->withToken($token)->postJson('/api/broadcasting/auth', ['channel_name' => 'private-users.'.$user->id, 'socket_id' => '1.2'])
            ->assertOk()->assertJsonStructure(['auth']);
        $this->postJson('/api/broadcasting/auth', ['channel_name' => 'private-users.'.$other->id, 'socket_id' => '1.2'])->assertForbidden();
        $this->postJson('/api/broadcasting/auth', ['channel_name' => 'private-staff', 'socket_id' => '1.2'])->assertForbidden();
    }

    #[TestWith(['admin', false])]
    #[TestWith(['unknown', true])]
    public function test_inactive_or_unknown_role_users_cannot_subscribe(string $role, bool $active): void
    {
        $user = User::factory()->create(['role' => $role, 'is_active' => $active]);
        $token = $user->createToken('test')->plainTextToken;
        $this->configureAuth();
        $this->withToken($token)->postJson('/api/broadcasting/auth', ['channel_name' => 'private-users.'.$user->id, 'socket_id' => '1.2'])->assertForbidden();
    }

    public function test_patient_mutations_are_data_free_and_scoped_to_staff_and_the_owner(): void
    {
        $staff = User::factory()->create(['role' => 'doctor']);
        $owner = User::factory()->create(['role' => 'patient']);
        $other = User::factory()->create(['role' => 'patient']);
        $inactive = User::factory()->create(['role' => 'admin', 'is_active' => false]);
        Event::fake([ApplicationInvalidated::class]);

        Patient::create(['user_id' => $owner->id, 'patient_number' => 'P1', 'first_name' => 'Confidential', 'phone' => '9800000001', 'allergies_summary' => 'Secret medical information']);

        Event::assertDispatched(ApplicationInvalidated::class, function ($event) use ($staff, $owner, $other, $inactive): bool {
            $channels = $this->channels($event);
            $this->assertSame(['scope' => 'application'], $event->broadcastWith());
            $this->assertSame('application.invalidated', $event->broadcastAs());

            return in_array('private-users.'.$staff->id, $channels) && in_array('private-users.'.$owner->id, $channels)
                && ! in_array('private-users.'.$other->id, $channels) && ! in_array('private-users.'.$inactive->id, $channels);
        });
        Event::assertDispatchedTimes(ApplicationInvalidated::class, 1);
    }

    public function test_nested_transactions_wait_for_outer_commit_and_discard_rolled_back_signals(): void
    {
        $staff = User::factory()->create(['role' => 'admin']);
        Event::fake([ApplicationInvalidated::class]);
        DB::beginTransaction();
        DB::beginTransaction();
        $staff->update(['name' => 'Committed']);
        DB::commit();
        Event::assertNotDispatched(ApplicationInvalidated::class);
        DB::commit();
        Event::assertDispatchedTimes(ApplicationInvalidated::class, 1);

        Event::fake([ApplicationInvalidated::class]);
        DB::beginTransaction();
        $staff->update(['name' => 'Rolled back']);
        DB::rollBack();
        Event::assertNotDispatched(ApplicationInvalidated::class);
        $this->assertSame('Committed', $staff->fresh()->name);

        DB::beginTransaction();
        DB::beginTransaction();
        $staff->update(['name' => 'Nested rollback']);
        DB::commit();
        DB::rollBack();
        Event::assertNotDispatched(ApplicationInvalidated::class);
        $this->assertSame('Committed', $staff->fresh()->name);
    }

    public function test_actual_reverb_wire_payload_contains_only_the_invalidation_scope(): void
    {
        $staff = User::factory()->create(['role' => 'admin']);
        User::factory()->create(['role' => 'patient']);
        $this->configureAuth();
        $pusher = Mockery::mock(Pusher::class);
        $pusher->shouldReceive('trigger')->once()->with(
            ['private-users.'.$staff->id], 'application.invalidated', ['scope' => 'application'], [],
        )->andReturn((object) []);
        Broadcast::connection('reverb')->setPusher($pusher);

        AiSetting::create(['base_url' => 'https://example.test', 'api_key' => 'never-broadcast-this-secret', 'model' => 'test']);
        $this->assertDatabaseCount('ai_settings', 1);
    }

    public function test_soft_deletion_restoration_and_reassignment_invalidate_affected_portal_users(): void
    {
        User::factory()->create(['role' => 'admin']);
        $oldOwner = User::factory()->create(['role' => 'patient']);
        $newOwner = User::factory()->create(['role' => 'patient']);
        $patient = Patient::create(['patient_number' => 'P1', 'first_name' => 'Patient', 'phone' => '9800000001', 'user_id' => $oldOwner->id]);
        Event::fake([ApplicationInvalidated::class]);
        $patient->update(['user_id' => $newOwner->id]);
        Event::assertDispatched(ApplicationInvalidated::class, fn ($event) => in_array('private-users.'.$oldOwner->id, $this->channels($event)) && in_array('private-users.'.$newOwner->id, $this->channels($event)));

        Event::fake([ApplicationInvalidated::class]);
        $patient->delete();
        $patient->restore();
        Event::assertDispatchedTimes(ApplicationInvalidated::class, 2);
        foreach (Event::dispatched(ApplicationInvalidated::class) as [$event]) {
            $this->assertContains('private-users.'.$newOwner->id, $this->channels($event));
            $this->assertNotContains('private-users.'.$oldOwner->id, $this->channels($event));
        }
    }

    public function test_login_bookkeeping_and_no_op_saves_do_not_broadcast(): void
    {
        $user = User::factory()->create(['role' => 'admin']);
        Event::fake([ApplicationInvalidated::class]);
        $user->forceFill(['last_login_at' => now(), 'remember_token' => 'secret'])->save();
        $user->save();
        Event::assertNotDispatched(ApplicationInvalidated::class);
    }

    public function test_notifications_only_invalidate_the_recipient_including_read_and_delete(): void
    {
        $owner = User::factory()->create(['role' => 'patient']);
        User::factory()->create(['role' => 'admin']);
        Event::fake([ApplicationInvalidated::class]);
        $notification = $owner->notifications()->create(['id' => (string) Str::uuid(), 'type' => 'test', 'data' => ['body' => 'Medical secret']]);
        $notification->markAsRead();
        $notification->delete();
        Event::assertDispatchedTimes(ApplicationInvalidated::class, 3);
        foreach (Event::dispatched(ApplicationInvalidated::class) as [$event]) {
            $this->assertSame(['private-users.'.$owner->id], $this->channels($event));
            $this->assertSame(['scope' => 'application'], $event->broadcastWith());
        }
    }

    public function test_reverb_transport_failure_does_not_fail_a_committed_http_write(): void
    {
        $user = User::factory()->create(['role' => 'admin']);
        $token = $user->createToken('test')->plainTextToken;
        $this->mock(Factory::class)->shouldReceive('queue')->once()->andThrow(new RuntimeException('Transport unavailable'));
        Log::spy();

        $this->withToken($token)->putJson('/api/v1/me', ['name' => 'Updated safely'])->assertOk();
        $this->assertSame('Updated safely', $user->fresh()->name);
        Log::shouldHaveReceived('warning')->with('Realtime invalidation delivery unavailable.')->atLeast()->once();
    }

    public function test_push_subscriptions_only_invalidate_the_owner_including_bulk_unsubscribe(): void
    {
        $owner = User::factory()->create(['role' => 'patient']);
        User::factory()->create(['role' => 'admin']);
        Event::fake([ApplicationInvalidated::class]);
        $endpoint = 'https://push.example.test/subscription';
        $owner->updatePushSubscription($endpoint, 'secret-key', 'secret-token');
        $this->withToken($owner->createToken('test')->plainTextToken)
            ->postJson('/api/v1/notifications/push/unsubscribe', ['endpoint' => $endpoint])->assertOk();
        $this->assertDatabaseCount('push_subscriptions', 0);
        Event::assertDispatchedTimes(ApplicationInvalidated::class, 2);
        foreach (Event::dispatched(ApplicationInvalidated::class) as [$event]) {
            $this->assertSame(['private-users.'.$owner->id], $this->channels($event));
            $this->assertSame(['scope' => 'application'], $event->broadcastWith());
        }
    }

    public function test_deactivated_accounts_receive_one_own_channel_invalidation_for_existing_sockets(): void
    {
        $user = User::factory()->create(['role' => 'patient']);
        $inactive = User::factory()->create(['role' => 'patient', 'is_active' => false]);
        Event::fake([ApplicationInvalidated::class]);
        $user->update(['is_active' => false]);
        Event::assertDispatched(ApplicationInvalidated::class, function ($event) use ($user, $inactive): bool {
            $this->assertNotContains('private-users.'.$inactive->id, $this->channels($event));

            return $this->channels($event) === ['private-users.'.$user->id] && $event->broadcastWith() === ['scope' => 'application'];
        });
    }

    public function test_empty_schedule_replacement_notifies_portal_users_after_bulk_removal(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $patient = User::factory()->create(['role' => 'patient']);
        $doctor = Doctor::create(['display_name' => 'Doctor']);
        DoctorSchedule::create(['doctor_id' => $doctor->id, 'day_of_week' => 1, 'start_time' => '09:00', 'end_time' => '12:00']);
        Event::fake([ApplicationInvalidated::class]);
        $this->withToken($admin->createToken('test')->plainTextToken)->putJson('/api/v1/doctors/'.$doctor->id.'/schedules', ['blocks' => []])->assertOk();
        $this->assertDatabaseCount('doctor_schedules', 0);
        Event::assertDispatched(ApplicationInvalidated::class, fn ($event) => in_array('private-users.'.$patient->id, $this->channels($event)));
    }

    public function test_all_persisted_domain_model_families_emit_invalidation_without_http_context(): void
    {
        $staff = User::factory()->create(['role' => 'admin']);
        $patientUser = User::factory()->create(['role' => 'patient']);
        $patient = Patient::create(['patient_number' => 'P1', 'first_name' => 'Patient', 'phone' => '9800000001', 'user_id' => $patientUser->id]);
        $doctor = Doctor::create(['display_name' => 'Doctor']);
        $visit = Visit::create(['visit_number' => 'V1', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'visit_date' => today()]);
        $prescription = Prescription::create(['prescription_number' => 'RX1', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'visit_id' => $visit->id]);
        $invoice = Invoice::create(['invoice_number' => 'I1', 'patient_id' => $patient->id, 'invoice_date' => today(), 'subtotal' => 10, 'total_amount' => 10]);
        $records = [
            [AiSetting::class, ['base_url' => 'https://example.test', 'api_key' => 'secret', 'model' => 'test']],
            [Appointment::class, ['appointment_number' => 'A1', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'appointment_date' => today(), 'start_time' => '10:00']],
            [AuditLog::class, ['action' => 'updated', 'entity_type' => 'test', 'summary' => 'Secret']],
            [ClinicSetting::class, ['clinic_name' => 'Clinic']],
            [DoctorSchedule::class, ['doctor_id' => $doctor->id, 'day_of_week' => 1, 'start_time' => '09:00', 'end_time' => '12:00']],
            [InvoiceItem::class, ['invoice_id' => $invoice->id, 'description' => 'Secret', 'quantity' => 1, 'unit_price' => 10, 'line_total' => 10]],
            [Payment::class, ['invoice_id' => $invoice->id, 'payment_number' => 'PAY1', 'amount' => 10, 'payment_method' => 'cash', 'paid_at' => now()]],
            [PrescriptionItem::class, ['prescription_id' => $prescription->id, 'medicine_name' => 'Secret', 'dosage' => '1', 'frequency' => 'daily', 'duration' => '1 day']],
            [VisitAmendment::class, ['visit_id' => $visit->id, 'reason' => 'Secret', 'notes' => 'Secret']],
            [WhatsAppConnection::class, ['id' => 1, 'waba_id' => '1', 'phone_number_id' => '1', 'display_phone_number' => '9800000001', 'token' => 'secret', 'connected_at' => now(), 'status' => 'connected']],
            [WhatsAppMessage::class, ['patient_id' => $patient->id, 'event' => 'test', 'to_number' => '9800000001', 'rendered_body' => 'Secret']],
            [WhatsAppTemplate::class, ['event' => 'test', 'template_name' => 'test', 'body' => 'Secret']],
            [WhatsAppMetaTemplate::class, ['waba_id' => '1', 'meta_template_id' => '1', 'name' => 'test', 'language' => 'en', 'components' => [], 'remote_hash' => 'hash']],
            [WhatsAppWebhookEvent::class, ['fingerprint' => 'hash', 'waba_id' => '1', 'field' => 'test', 'payload' => ['secret' => 'medical'], 'received_at' => now()]],
        ];
        foreach ($records as [$class, $attributes]) {
            Event::fake([ApplicationInvalidated::class]);
            $class::create($attributes);
            Event::assertDispatched(ApplicationInvalidated::class, fn ($event) => in_array('private-users.'.$staff->id, $this->channels($event)) && $event->broadcastWith() === ['scope' => 'application']);
        }
        foreach ([$staff, $patient, $doctor, $visit, $prescription, $invoice] as $model) {
            Event::fake([ApplicationInvalidated::class]);
            $attribute = match (true) {
                $model instanceof User => 'name', $model instanceof Patient => 'first_name',
                $model instanceof Doctor => 'display_name', $model instanceof Visit => 'diagnosis',
                $model instanceof Prescription => 'instructions', default => 'notes',
            };
            $model->update([$attribute => 'Changed']);
            Event::assertDispatched(ApplicationInvalidated::class);
        }
    }
}
