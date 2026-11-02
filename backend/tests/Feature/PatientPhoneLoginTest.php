<?php

namespace Tests\Feature;

use App\Models\Patient;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PatientPhoneLoginTest extends TestCase
{
    use RefreshDatabase;

    private function adminToken(): string
    {
        return User::factory()->create(['role' => 'admin'])->createToken('test')->plainTextToken;
    }

    private function createPatientWithLogin(string $phone, string $password = 'PatientPass123'): array
    {
        $response = $this->withToken($this->adminToken())->postJson('/api/v1/patients', [
            'first_name' => 'Pat',
            'phone' => $phone,
            'login_password' => $password,
        ]);
        $response->assertCreated();

        return $response->json('data');
    }

    public function test_patient_signs_in_with_phone_and_password(): void
    {
        $this->createPatientWithLogin('9876543210');

        $this->postJson('/api/v1/login', ['login' => '9876543210', 'password' => 'PatientPass123'])
            ->assertOk()
            ->assertJsonPath('data.user.role', 'patient');
    }

    public function test_phone_formatting_does_not_matter(): void
    {
        $this->createPatientWithLogin('+91 98765-43210');

        foreach (['9876543210', '+91 98765 43210', '098765-43210', '+91-9876543210'] as $typed) {
            $this->postJson('/api/v1/login', ['login' => $typed, 'password' => 'PatientPass123'])->assertOk();
        }
    }

    public function test_wrong_password_is_rejected_for_phone_login(): void
    {
        $this->createPatientWithLogin('9811122233');

        $this->postJson('/api/v1/login', ['login' => '9811122233', 'password' => 'WrongPassword1'])->assertStatus(422);
    }

    public function test_staff_cannot_sign_in_with_phone_only_email(): void
    {
        User::factory()->create(['role' => 'receptionist', 'phone' => '9123456789']);

        $this->postJson('/api/v1/login', ['login' => '9123456789', 'password' => 'password'])->assertStatus(422);
    }

    public function test_staff_email_sign_in_still_works(): void
    {
        $staff = User::factory()->create(['role' => 'receptionist']);

        $this->postJson('/api/v1/login', ['login' => $staff->email, 'password' => 'password'])
            ->assertOk()
            ->assertJsonPath('data.user.role', 'receptionist');
    }

    public function test_two_portal_patients_cannot_share_a_sign_in_phone(): void
    {
        $this->createPatientWithLogin('9800000001');

        $this->withToken($this->adminToken())->postJson('/api/v1/patients', [
            'first_name' => 'Second',
            'phone' => '+91 98000 00001',
            'login_password' => 'PatientPass123',
        ])->assertStatus(422);
    }

    public function test_changing_patient_phone_moves_the_sign_in(): void
    {
        $created = $this->createPatientWithLogin('9700000001');
        $admin = $this->adminToken();

        $this->withToken($admin)->putJson("/api/v1/patients/{$created['id']}", ['phone' => '9700000002'])->assertOk();

        $this->postJson('/api/v1/login', ['login' => '9700000002', 'password' => 'PatientPass123'])->assertOk();
        $this->postJson('/api/v1/login', ['login' => '9700000001', 'password' => 'PatientPass123'])->assertStatus(422);
    }

    public function test_phone_change_to_a_number_in_use_is_rejected(): void
    {
        $first = $this->createPatientWithLogin('9600000001');
        $second = $this->createPatientWithLogin('9600000002');
        $this->assertNotNull(Patient::find($first['id'])->user_id);

        $this->withToken($this->adminToken())->putJson("/api/v1/patients/{$second['id']}", ['phone' => '9600000001'])
            ->assertStatus(422);
    }

    public function test_disabled_portal_login_cannot_sign_in(): void
    {
        $created = $this->createPatientWithLogin('9500000001');

        $this->withToken($this->adminToken())->putJson("/api/v1/patients/{$created['id']}", ['login_active' => false])->assertOk();

        $this->postJson('/api/v1/login', ['login' => '9500000001', 'password' => 'PatientPass123'])->assertStatus(422);
    }
}
