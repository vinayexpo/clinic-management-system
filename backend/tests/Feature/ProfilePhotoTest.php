<?php

namespace Tests\Feature;

use App\Models\Patient;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ProfilePhotoTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function token(User $user): string
    {
        return $user->createToken('test')->plainTextToken;
    }

    public function test_staff_uploads_their_own_profile_photo(): void
    {
        $doctor = User::factory()->create(['role' => 'doctor', 'name' => 'Dr Asha']);

        $response = $this->withToken($this->token($doctor))
            ->post('/api/v1/me', ['avatar' => UploadedFile::fake()->image('me.png', 300, 300)])
            ->assertOk();

        $response->assertJsonPath('data.has_avatar', true);
        $doctor->refresh();
        $this->assertNotNull($doctor->avatar_path);
        Storage::disk('local')->assertExists($doctor->avatar_path);

        $this->withToken($this->token($doctor))
            ->get("/api/v1/users/{$doctor->id}/avatar")
            ->assertOk();
    }

    public function test_staff_updates_their_own_name_and_phone(): void
    {
        $receptionist = User::factory()->create(['role' => 'receptionist', 'name' => 'Front Desk', 'phone' => '9000000000']);

        $this->withToken($this->token($receptionist))
            ->put('/api/v1/me', ['name' => 'Front Desk Lead', 'phone' => '9000000001'])
            ->assertOk()
            ->assertJsonPath('data.name', 'Front Desk Lead')
            ->assertJsonPath('data.phone', '9000000001');
    }

    public function test_staff_cannot_change_their_own_role_or_account_state(): void
    {
        $doctor = User::factory()->create(['role' => 'doctor']);

        $this->withToken($this->token($doctor))
            ->put('/api/v1/me', ['role' => 'admin', 'is_active' => false, 'email' => 'hijack@example.test'])
            ->assertOk()
            ->assertJsonPath('data.role', 'doctor')
            ->assertJsonPath('data.is_active', true)
            ->assertJsonPath('data.email', $doctor->email);
    }

    public function test_staff_can_remove_their_own_photo(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $this->withToken($this->token($admin))
            ->post('/api/v1/me', ['avatar' => UploadedFile::fake()->image('me.jpg')])
            ->assertOk();
        $path = $admin->fresh()->avatar_path;
        $this->assertNotNull($path);

        $this->withToken($this->token($admin))
            ->put('/api/v1/me', ['remove_avatar' => true])
            ->assertOk()
            ->assertJsonPath('data.has_avatar', false);

        Storage::disk('local')->assertMissing($path);
    }

    public function test_patients_cannot_use_the_staff_profile_endpoint(): void
    {
        $patientUser = User::factory()->create(['role' => 'patient']);

        $this->withToken($this->token($patientUser))
            ->put('/api/v1/me', ['name' => 'Renamed'])
            ->assertForbidden();
    }

    public function test_a_patient_uploads_their_own_photo_in_the_portal(): void
    {
        $patientUser = User::factory()->create(['role' => 'patient']);
        $patient = Patient::create([
            'patient_number' => 'PAT-PHOTO-1', 'first_name' => 'Asha', 'phone' => '9000011111',
            'created_by' => $patientUser->id, 'user_id' => $patientUser->id,
        ]);

        $this->withToken($this->token($patientUser))
            ->post('/api/v1/portal/me', ['avatar' => UploadedFile::fake()->image('me.png')])
            ->assertOk()
            ->assertJsonPath('data.has_avatar', true);

        $patient->refresh();
        $this->assertNotNull($patient->avatar_path);
        Storage::disk('local')->assertExists($patient->avatar_path);
    }

    public function test_a_patient_cannot_change_clinical_details_from_the_portal(): void
    {
        $patientUser = User::factory()->create(['role' => 'patient']);
        $patient = Patient::create([
            'patient_number' => 'PAT-PHOTO-2', 'first_name' => 'Asha', 'phone' => '9000022222',
            'created_by' => $patientUser->id, 'user_id' => $patientUser->id,
        ]);

        $this->withToken($this->token($patientUser))
            ->put('/api/v1/portal/me', ['first_name' => 'Renamed', 'patient_number' => 'PAT-HACK', 'phone' => '9000000000'])
            ->assertOk()
            ->assertJsonPath('data.first_name', 'Asha')
            ->assertJsonPath('data.patient_number', 'PAT-PHOTO-2')
            ->assertJsonPath('data.phone', '9000022222');
    }

    public function test_profile_photo_uploads_require_authentication(): void
    {
        $this->post('/api/v1/me', ['avatar' => UploadedFile::fake()->image('me.png')])->assertUnauthorized();
        $this->put('/api/v1/portal/me', ['avatar' => UploadedFile::fake()->image('me.png')])->assertUnauthorized();
    }
}
