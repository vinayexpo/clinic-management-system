<?php

namespace Tests\Feature;

use App\Models\Doctor;
use App\Models\Patient;
use App\Models\User;
use App\Models\Visit;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class AdminSetupAndStaffTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function tokenFor(User $user): string
    {
        return $user->createToken('test')->plainTextToken;
    }

    public function test_setup_is_open_without_admin_and_closed_afterwards(): void
    {
        $this->getJson('/api/v1/setup/status')->assertOk()->assertJsonPath('data.needs_setup', true);

        $this->postJson('/api/v1/setup/admin', [
            'name' => 'Owner',
            'email' => 'owner@clinic.test',
            'password' => 'SuperSecret123',
            'password_confirmation' => 'SuperSecret123',
        ])->assertCreated()->assertJsonPath('data.user.role', 'admin');

        $this->getJson('/api/v1/setup/status')->assertJsonPath('data.needs_setup', false);

        $this->postJson('/api/v1/setup/admin', [
            'name' => 'Intruder',
            'email' => 'intruder@clinic.test',
            'password' => 'SuperSecret123',
            'password_confirmation' => 'SuperSecret123',
        ])->assertStatus(409);
    }

    public function test_default_database_seeding_does_not_create_demo_users_or_patient_records(): void
    {
        $this->seed(DatabaseSeeder::class);

        $this->assertDatabaseCount('users', 0);
        $this->assertDatabaseCount('patients', 0);
        $this->getJson('/api/v1/setup/status')->assertOk()->assertJsonPath('data.needs_setup', true);
    }

    public function test_only_admins_manage_staff(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $reception = User::factory()->create(['role' => 'receptionist']);

        $this->withToken($this->tokenFor($reception))->getJson('/api/v1/users')->assertForbidden();

        // The auth guard caches the resolved user per application instance; reset it between identities.
        $this->app['auth']->forgetGuards();
        $response = $this->withToken($this->tokenFor($admin))->postJson('/api/v1/users', [
            'name' => 'Dr Mehta',
            'email' => 'mehta@clinic.test',
            'password' => 'DoctorPass12345',
            'role' => 'doctor',
            'consultation_fee' => 500,
        ]);
        $this->assertSame(201, $response->status(), (string) $response->getContent());
        $response->assertJsonPath('data.role', 'doctor');

        $this->assertTrue(Doctor::where('display_name', 'Dr Mehta')->exists());
    }

    public function test_admin_updates_and_uploads_avatar_then_deactivates_staff(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $staff = User::factory()->create(['role' => 'receptionist']);
        $token = $this->tokenFor($admin);

        $this->withToken($token)->post("/api/v1/users/{$staff->id}", [
            'name' => 'Front Desk Lead',
            'avatar' => UploadedFile::fake()->image('me.png', 200, 200),
        ])->assertOk()->assertJsonPath('data.name', 'Front Desk Lead')->assertJsonPath('data.has_avatar', true);

        Storage::disk('local')->assertExists($staff->fresh()->avatar_path);

        $this->withToken($token)->deleteJson("/api/v1/users/{$staff->id}")->assertOk();
        $this->assertFalse($staff->fresh()->is_active);
    }

    public function test_admin_can_edit_doctor_profile_fields_from_the_staff_account(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $doctorUser = User::factory()->create(['role' => 'doctor']);
        $doctor = Doctor::create(['user_id' => $doctorUser->id, 'display_name' => $doctorUser->name, 'consultation_fee' => 0, 'is_active' => true]);

        $this->withToken($this->tokenFor($admin))->putJson("/api/v1/users/{$doctorUser->id}", [
            'specialization' => 'Dermatology',
            'qualification' => 'MBBS, MD',
            'registration_number' => 'KA-12345',
            'consultation_fee' => 650,
        ])->assertOk()->assertJsonPath('data.doctor.specialization', 'Dermatology');

        $this->assertDatabaseHas('doctors', ['id' => $doctor->id, 'specialization' => 'Dermatology', 'consultation_fee' => 650]);
    }

    public function test_last_active_admin_cannot_be_deactivated(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $other = User::factory()->create(['role' => 'admin']);

        $this->withToken($this->tokenFor($other))->deleteJson("/api/v1/users/{$admin->id}")->assertOk();
        $this->withToken($this->tokenFor($other))->deleteJson("/api/v1/users/{$other->id}")->assertStatus(422);
    }

    public function test_patient_list_filters_sorts_and_paginates(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Patient::create(['patient_number' => 'PAT-A', 'first_name' => 'Aarav', 'phone' => '9000000001', 'sex' => 'male', 'created_by' => $admin->id]);
        Patient::create(['patient_number' => 'PAT-B', 'first_name' => 'Mira', 'phone' => '9000000002', 'sex' => 'female', 'created_by' => $admin->id]);
        Patient::create(['patient_number' => 'PAT-C', 'first_name' => 'Mohan', 'phone' => '9000000003', 'sex' => 'male', 'created_by' => $admin->id]);
        $token = $this->tokenFor($admin);

        $this->withToken($token)->getJson('/api/v1/patients?search=Mo&sex=male&sort=first_name&direction=asc&per_page=10')
            ->assertOk()
            ->assertJsonCount(1, 'data.data')
            ->assertJsonPath('data.data.0.first_name', 'Mohan');

        $this->withToken($token)->getJson('/api/v1/patients?per_page=2')
            ->assertOk()
            ->assertJsonPath('data.per_page', 2)
            ->assertJsonPath('data.total', 3)
            ->assertJsonCount(2, 'data.data');
    }

    public function test_patient_with_history_cannot_be_deleted(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $patient = Patient::create(['patient_number' => 'PAT-Z', 'first_name' => 'Zed', 'phone' => '9000000009', 'created_by' => $admin->id]);
        $doctorUser = User::factory()->create(['role' => 'doctor']);
        $doctor = Doctor::create(['user_id' => $doctorUser->id, 'display_name' => 'Dr Z', 'consultation_fee' => 0, 'is_active' => true]);
        Visit::create(['visit_number' => 'VIS-Z', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'visit_date' => today(), 'status' => 'draft', 'created_by' => $admin->id]);

        $this->withToken($this->tokenFor($admin))->deleteJson("/api/v1/patients/{$patient->id}")->assertStatus(422);
    }
}
