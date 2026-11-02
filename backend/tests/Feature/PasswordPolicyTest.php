<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PasswordPolicyTest extends TestCase
{
    use RefreshDatabase;

    private function adminToken(): string
    {
        return User::factory()->create(['role' => 'admin'])->createToken('test')->plainTextToken;
    }

    private function staffPayload(string $password): array
    {
        return ['name' => 'Staff Member', 'email' => 'staff'.uniqid().'@clinic.test', 'password' => $password, 'role' => 'receptionist'];
    }

    public function test_setup_admin_accepts_eight_characters(): void
    {
        $this->postJson('/api/v1/setup/admin', [
            'name' => 'Owner',
            'email' => 'owner@clinic.test',
            'password' => 'Abcd1234',
            'password_confirmation' => 'Abcd1234',
        ])->assertCreated();
    }

    public function test_setup_admin_rejects_seven_characters(): void
    {
        $this->postJson('/api/v1/setup/admin', [
            'name' => 'Owner',
            'email' => 'owner@clinic.test',
            'password' => 'Abcd123',
            'password_confirmation' => 'Abcd123',
        ])->assertStatus(422)->assertJsonValidationErrors(['password']);
    }

    public function test_staff_create_accepts_eight_and_rejects_seven(): void
    {
        $token = $this->adminToken();

        $this->withToken($token)->postJson('/api/v1/users', $this->staffPayload('Abcd1234'))->assertCreated();
        $this->withToken($token)->postJson('/api/v1/users', $this->staffPayload('Abcd123'))
            ->assertStatus(422)->assertJsonValidationErrors(['password']);
    }

    public function test_portal_login_password_accepts_eight_and_rejects_seven(): void
    {
        $token = $this->adminToken();

        $this->withToken($token)->postJson('/api/v1/patients', [
            'first_name' => 'Eight', 'phone' => '9911100001', 'login_password' => 'Abcd1234',
        ])->assertCreated();

        $this->withToken($token)->postJson('/api/v1/patients', [
            'first_name' => 'Seven', 'phone' => '9911100002', 'login_password' => 'Abcd123',
        ])->assertStatus(422)->assertJsonValidationErrors(['login_password']);
    }

    public function test_portal_password_reset_accepts_eight_and_rejects_seven(): void
    {
        $token = $this->adminToken();
        $created = $this->withToken($token)->postJson('/api/v1/patients', [
            'first_name' => 'Reset', 'phone' => '9911100003', 'login_password' => 'Abcd1234',
        ])->json('data');

        $this->withToken($token)->postJson("/api/v1/patients/{$created['id']}/portal-password", ['password' => 'Wxyz9876'])->assertOk();
        $this->withToken($token)->postJson("/api/v1/patients/{$created['id']}/portal-password", ['password' => 'Wxyz987'])
            ->assertStatus(422)->assertJsonValidationErrors(['password']);
    }
}
