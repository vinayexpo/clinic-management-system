<?php

namespace Tests\Feature;

use App\Models\Patient;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PhotoManagerTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function adminToken(): string
    {
        return User::factory()->create(['role' => 'admin'])->createToken('test')->plainTextToken;
    }

    public function test_the_list_merges_staff_and_patients_with_photo_state(): void
    {
        $staff = User::factory()->create(['role' => 'doctor', 'name' => 'Dr Asha']);
        $patient = Patient::create([
            'patient_number' => 'PAT-PM-1', 'first_name' => 'Ravi', 'last_name' => 'Kumar',
            'phone' => '9000033333', 'created_by' => $staff->id,
        ]);

        $response = $this->withToken($this->adminToken())->getJson('/api/v1/photos')->assertOk();
        $rows = $response->json('data.data');

        $this->assertCount(3, $rows);
        $this->assertContains('Dr Asha', array_column($rows, 'name'));
        $this->assertContains('Ravi Kumar', array_column($rows, 'name'));
        $this->assertSame(['PAT-PM-1'], array_values(array_map(
            fn (array $row): string => $row['detail'],
            array_filter($rows, fn (array $row): bool => $row['type'] === 'patient'),
        )));
    }

    public function test_the_list_filters_by_type_search_and_photo_state(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'name' => 'Clinic Admin']);
        $doctor = User::factory()->create(['role' => 'doctor', 'name' => 'Dr Mehta']);
        Patient::create([
            'patient_number' => 'PAT-PM-2', 'first_name' => 'Sita', 'phone' => '9000044444',
            'created_by' => $admin->id,
        ]);
        $withPhoto = Patient::create([
            'patient_number' => 'PAT-PM-3', 'first_name' => 'Anita', 'phone' => '9000055555',
            'created_by' => $admin->id,
        ]);
        $withPhoto->update(['avatar_path' => 'avatars/patients/existing.png']);
        Storage::disk('local')->put('avatars/patients/existing.png', 'x');

        $token = $this->adminToken();

        $staffOnly = $this->withToken($token)->getJson('/api/v1/photos?type=staff')->assertOk()->json('data.data');
        $this->assertSame(['admin', 'doctor'], array_values(array_unique(array_column($staffOnly, 'detail'))));

        $patientsOnly = $this->withToken($token)->getJson('/api/v1/photos?type=patients')->assertOk()->json('data.data');
        $details = array_values(array_column($patientsOnly, 'detail'));
        sort($details);
        $this->assertSame(['PAT-PM-2', 'PAT-PM-3'], $details);
        $this->assertSame(['patient'], array_values(array_unique(array_column($patientsOnly, 'type'))));

        $search = $this->withToken($token)->getJson('/api/v1/photos?search=Sita')->assertOk()->json('data.data');
        $this->assertSame(['Sita'], array_column($search, 'name'));

        $withPhotos = $this->withToken($token)->getJson('/api/v1/photos?has_photo=1')->assertOk()->json('data.data');
        $this->assertSame(['Anita'], array_column($withPhotos, 'name'));

        $withoutPhotos = $this->withToken($token)->getJson('/api/v1/photos?has_photo=0')->assertOk()->json('data.data');
        $this->assertNotContains('Anita', array_column($withoutPhotos, 'name'));
        $this->assertContains('Dr Mehta', array_column($withoutPhotos, 'name'));
    }

    public function test_an_admin_replaces_a_patient_photo(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $patient = Patient::create([
            'patient_number' => 'PAT-PM-4', 'first_name' => 'Neha', 'phone' => '9000066666',
            'created_by' => $admin->id, 'avatar_path' => 'avatars/patients/old.png',
        ]);
        Storage::disk('local')->put('avatars/patients/old.png', 'old');

        $this->withToken($this->adminToken())
            ->post('/api/v1/photos/patients/'.$patient->id, ['avatar' => UploadedFile::fake()->image('new.png')])
            ->assertOk()
            ->assertJsonPath('data.has_photo', true);

        $patient->refresh();
        $this->assertNotSame('avatars/patients/old.png', $patient->avatar_path);
        Storage::disk('local')->assertMissing('avatars/patients/old.png');
        Storage::disk('local')->assertExists($patient->avatar_path);
    }

    public function test_an_admin_replaces_a_staff_photo(): void
    {
        $doctor = User::factory()->create(['role' => 'doctor']);

        $this->withToken($this->adminToken())
            ->post('/api/v1/photos/staff/'.$doctor->id, ['avatar' => UploadedFile::fake()->image('me.jpg')])
            ->assertOk();

        $doctor->refresh();
        $this->assertNotNull($doctor->avatar_path);
        Storage::disk('local')->assertExists($doctor->avatar_path);
    }

    public function test_an_admin_removes_a_photo_without_touching_the_record(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $patient = Patient::create([
            'patient_number' => 'PAT-PM-5', 'first_name' => 'Ira', 'phone' => '9000077777',
            'created_by' => $admin->id, 'avatar_path' => 'avatars/patients/gone.png',
        ]);
        Storage::disk('local')->put('avatars/patients/gone.png', 'x');

        $this->withToken($this->adminToken())
            ->delete('/api/v1/photos/patients/'.$patient->id)
            ->assertOk()
            ->assertJsonPath('data.has_photo', false);

        $patient->refresh();
        $this->assertNull($patient->avatar_path);
        $this->assertSame('PAT-PM-5', $patient->patient_number);
        Storage::disk('local')->assertMissing('avatars/patients/gone.png');
    }

    public function test_doctors_and_receptionists_manage_photos_for_their_own_role_only(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $doctor = User::factory()->create(['role' => 'doctor', 'name' => 'Dr Scope']);
        $receptionist = User::factory()->create(['role' => 'receptionist', 'name' => 'Front Scope']);
        $patient = Patient::create([
            'patient_number' => 'PAT-PM-6', 'first_name' => 'Nita', 'phone' => '9000088888',
            'created_by' => $admin->id,
        ]);

        // A doctor only sees doctor accounts.
        $doctorRows = $this->actingAs($doctor, 'sanctum')->getJson('/api/v1/photos')->assertOk()->json('data.data');
        $this->assertSame(['doctor'], array_values(array_unique(array_column($doctorRows, 'detail'))));
        $this->assertCount(1, $doctorRows);

        // A receptionist only sees reception accounts.
        $receptionRows = $this->actingAs($receptionist, 'sanctum')->getJson('/api/v1/photos')->assertOk()->json('data.data');
        $this->assertSame(['receptionist'], array_values(array_unique(array_column($receptionRows, 'detail'))));

        // A doctor can manage a doctor photo.
        $this->actingAs($doctor, 'sanctum')
            ->post('/api/v1/photos/staff/'.$doctor->id, ['avatar' => UploadedFile::fake()->image('me.png')])
            ->assertOk()
            ->assertJsonPath('data.has_photo', true);
        $this->actingAs($doctor, 'sanctum')
            ->delete('/api/v1/photos/staff/'.$doctor->id)
            ->assertOk()
            ->assertJsonPath('data.has_photo', false);

        // A doctor cannot touch a receptionist or a patient.
        $this->actingAs($doctor, 'sanctum')
            ->post('/api/v1/photos/staff/'.$receptionist->id, ['avatar' => UploadedFile::fake()->image('me.png')])
            ->assertForbidden();
        $this->actingAs($doctor, 'sanctum')
            ->delete('/api/v1/photos/patients/'.$patient->id)
            ->assertForbidden();

        // A receptionist cannot touch a doctor either.
        $this->actingAs($receptionist, 'sanctum')
            ->post('/api/v1/photos/staff/'.$doctor->id, ['avatar' => UploadedFile::fake()->image('me.png')])
            ->assertForbidden();
    }

    public function test_an_administrator_manages_every_photo(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $doctor = User::factory()->create(['role' => 'doctor']);
        $receptionist = User::factory()->create(['role' => 'receptionist']);
        $patient = Patient::create([
            'patient_number' => 'PAT-PM-7', 'first_name' => 'Omkar', 'phone' => '9000091111',
            'created_by' => $admin->id,
        ]);
        $token = $admin->createToken('test')->plainTextToken;

        $rows = $this->withToken($token)->getJson('/api/v1/photos')->assertOk()->json('data.data');
        $this->assertContains('patient', array_column($rows, 'type'));
        foreach ([['staff', $admin->id], ['staff', $doctor->id], ['staff', $receptionist->id], ['patient', $patient->id]] as [$type, $id]) {
            $this->assertTrue(
                collect($rows)->contains(fn (array $row): bool => $row['type'] === $type && (int) $row['id'] === $id),
                'Admin must see every account in the photo manager.',
            );
        }

        // The admin can replace and remove a photo for each group.
        // The type segment accepts the same value the list rows carry.
        foreach ([['staff', $doctor->id], ['staff', $receptionist->id], ['patient', $patient->id]] as [$type, $id]) {
            $this->withToken($token)
                ->post("/api/v1/photos/{$type}/{$id}", ['avatar' => UploadedFile::fake()->image('p.png')])
                ->assertOk()
                ->assertJsonPath('data.has_photo', true);

            $this->withToken($token)
                ->delete("/api/v1/photos/{$type}/{$id}")
                ->assertOk()
                ->assertJsonPath('data.has_photo', false);
        }

        // The list filter accepts the singular type as well.
        $patientsOnly = $this->withToken($token)->getJson('/api/v1/photos?type=patient')->assertOk()->json('data.data');
        $this->assertSame(['patient'], array_values(array_unique(array_column($patientsOnly, 'type'))));
    }

    public function test_a_portal_account_appears_once_and_its_photo_lives_on_the_patient_record(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $portalUser = User::factory()->create(['role' => 'patient', 'name' => 'Portal Holder']);
        $patient = Patient::create([
            'patient_number' => 'PAT-PM-8', 'first_name' => 'Rhea', 'phone' => '9000101010',
            'created_by' => $admin->id, 'user_id' => $portalUser->id,
        ]);
        $token = $admin->createToken('test')->plainTextToken;

        $rows = $this->withToken($token)->getJson('/api/v1/photos')->assertOk()->json('data.data');
        $patientRows = collect($rows)->where('type', 'patient')->where('id', $patient->id);
        $this->assertCount(1, $patientRows);
        // The portal login itself is not listed again: its photo is the patient record's photo.
        $this->assertCount(0, collect($rows)->where('type', 'staff')->where('id', $portalUser->id));

        // A patient login cannot hold a photo of its own.
        $this->withToken($token)
            ->post('/api/v1/users', [
                'name' => 'Portal New', 'email' => 'portal.new@example.test', 'password' => 'Password123',
                'role' => 'patient', 'avatar' => UploadedFile::fake()->image('p.png'),
            ])
            ->assertUnprocessable();
    }

    public function test_patients_cannot_use_the_photo_manager(): void
    {
        $patientUser = User::factory()->create(['role' => 'patient']);
        $token = $patientUser->createToken('test')->plainTextToken;

        $this->withToken($token)->getJson('/api/v1/photos')->assertForbidden();
        $this->withToken($token)->post('/api/v1/photos/staff/1', ['avatar' => UploadedFile::fake()->image('x.png')])->assertForbidden();
        $this->withToken($token)->delete('/api/v1/photos/patients/1')->assertForbidden();
    }

    public function test_unknown_owners_and_uploads_are_rejected(): void
    {
        $token = $this->adminToken();

        $this->withToken($token)->getJson('/api/v1/photos?type=other')->assertUnprocessable();
        $this->withToken($token)->post('/api/v1/photos/unknown/1', ['avatar' => UploadedFile::fake()->image('x.png')])->assertNotFound();
        $this->withToken($token)->post('/api/v1/photos/staff/999', ['avatar' => UploadedFile::fake()->image('x.png')])->assertNotFound();
        $this->withToken($token)->post('/api/v1/photos/staff/1', ['avatar' => UploadedFile::fake()->create('note.txt', 10, 'text/plain')])->assertUnprocessable();
    }
}
