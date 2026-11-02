<?php

namespace Tests\Feature;

use App\Models\Doctor;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\User;
use App\Models\Visit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PatientPortalTest extends TestCase
{
    use RefreshDatabase;

    private function tokenFor(User $user): string
    {
        return $user->createToken('test')->plainTextToken;
    }

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    public function test_admin_creates_patient_with_portal_login(): void
    {
        $admin = $this->admin();

        $response = $this->withToken($this->tokenFor($admin))->postJson('/api/v1/patients', [
            'first_name' => 'Asha',
            'last_name' => 'Verma',
            'phone' => '9000011111',
            'login_phone' => '9811100001',
            'login_password' => 'PatientPass123',
        ]);

        $response->assertCreated()->assertJsonPath('data.has_login', true)->assertJsonPath('data.login_phone', '9811100001');
        $login = User::where('phone', '9811100001')->first();
        $this->assertNotNull($login);
        $this->assertSame('patient', $login->role);
        $this->assertSame($login->id, Patient::find($response->json('data.id'))->user_id);
    }

    public function test_receptionist_cannot_create_portal_login(): void
    {
        $reception = User::factory()->create(['role' => 'receptionist']);

        $this->withToken($this->tokenFor($reception))->postJson('/api/v1/patients', [
            'first_name' => 'Ravi',
            'phone' => '9000022222',
            'login_phone' => '9811100002',
            'login_password' => 'PatientPass123',
        ])->assertForbidden();

        $this->assertFalse(User::where('phone', '9811100002')->exists());
    }

    public function test_receptionist_can_register_patient_without_login(): void
    {
        $reception = User::factory()->create(['role' => 'receptionist']);

        $this->withToken($this->tokenFor($reception))->postJson('/api/v1/patients', [
            'first_name' => 'Noor',
            'phone' => '9000033333',
        ])->assertCreated()->assertJsonPath('data.has_login', false);
    }

    public function test_only_admin_can_delete_patient_and_deletion_disables_login(): void
    {
        $admin = $this->admin();
        $reception = User::factory()->create(['role' => 'receptionist']);
        $login = User::factory()->create(['role' => 'patient']);
        $patient = Patient::create(['user_id' => $login->id, 'patient_number' => 'PAT-D', 'first_name' => 'Del', 'phone' => '9000044444', 'created_by' => $admin->id]);

        $this->withToken($this->tokenFor($reception))->deleteJson("/api/v1/patients/{$patient->id}")->assertForbidden();

        // Reset the cached auth guard between identities within one test.
        $this->app['auth']->forgetGuards();
        $this->withToken($this->tokenFor($admin))->deleteJson("/api/v1/patients/{$patient->id}")->assertOk();
        $this->assertFalse($login->fresh()->is_active);
    }

    public function test_admin_can_disable_and_reset_portal_login(): void
    {
        $admin = $this->admin();
        $login = User::factory()->create(['role' => 'patient']);
        $patient = Patient::create(['user_id' => $login->id, 'patient_number' => 'PAT-R', 'first_name' => 'Rhea', 'phone' => '9000055555', 'created_by' => $admin->id]);

        $this->withToken($this->tokenFor($admin))->putJson("/api/v1/patients/{$patient->id}", [
            'login_active' => false,
        ])->assertOk();
        $this->assertFalse($login->fresh()->is_active);

        $this->withToken($this->tokenFor($admin))->postJson("/api/v1/patients/{$patient->id}/portal-password", [
            'password' => 'BrandNewPass99',
        ])->assertOk();
        $this->assertTrue($login->fresh()->is_active);
    }

    public function test_patient_sees_only_own_record_and_data(): void
    {
        $admin = $this->admin();
        $doctorUser = User::factory()->create(['role' => 'doctor']);
        $doctor = Doctor::create(['user_id' => $doctorUser->id, 'display_name' => 'Dr P', 'consultation_fee' => 0, 'is_active' => true]);

        $loginA = User::factory()->create(['role' => 'patient']);
        $patientA = Patient::create(['user_id' => $loginA->id, 'patient_number' => 'PAT-A1', 'first_name' => 'A', 'phone' => '9000066666', 'created_by' => $admin->id]);
        $patientB = Patient::create(['patient_number' => 'PAT-B1', 'first_name' => 'B', 'phone' => '9000077777', 'created_by' => $admin->id]);
        Visit::create(['visit_number' => 'VIS-B', 'patient_id' => $patientB->id, 'doctor_id' => $doctor->id, 'visit_date' => today(), 'status' => 'finalized', 'created_by' => $admin->id]);
        Invoice::create(['invoice_number' => 'INV-A', 'patient_id' => $patientA->id, 'invoice_date' => today(), 'subtotal' => 500, 'discount_amount' => 0, 'total_amount' => 500, 'status' => 'unpaid', 'created_by' => $admin->id]);

        $token = $this->tokenFor($loginA);

        $this->withToken($token)->getJson('/api/v1/portal/me')->assertOk()->assertJsonPath('data.id', $patientA->id);
        $this->withToken($token)->getJson('/api/v1/portal/visits')->assertOk()->assertJsonCount(0, 'data.data');
        $this->withToken($token)->getJson('/api/v1/portal/invoices')->assertOk()->assertJsonCount(1, 'data.data');

        // A patient may not use staff endpoints, even to read a different patient.
        $this->withToken($token)->getJson("/api/v1/patients/{$patientB->id}")->assertForbidden();
        $this->withToken($token)->getJson('/api/v1/patients')->assertForbidden();
        $this->withToken($token)->getJson('/api/v1/users')->assertForbidden();
    }

    public function test_patient_cannot_write_patient_records(): void
    {
        $login = User::factory()->create(['role' => 'patient']);
        $patient = Patient::create(['user_id' => $login->id, 'patient_number' => 'PAT-W', 'first_name' => 'W', 'phone' => '9000088888', 'created_by' => $this->admin()->id]);

        $this->withToken($this->tokenFor($login))->putJson("/api/v1/patients/{$patient->id}", ['phone' => '1'])->assertForbidden();
        $this->withToken($this->tokenFor($login))->postJson('/api/v1/patients', ['first_name' => 'X', 'phone' => '1'])->assertForbidden();
    }

    public function test_staff_cannot_create_patient_login_through_user_screen(): void
    {
        $admin = $this->admin();

        $this->withToken($this->tokenFor($admin))->postJson('/api/v1/users', [
            'name' => 'Sneaky',
            'email' => 'sneaky@x.test',
            'password' => 'PatientPass123',
            'role' => 'patient',
        ])->assertStatus(422);
    }
}
