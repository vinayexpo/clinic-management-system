<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UnauthenticatedApiTest extends TestCase
{
    use RefreshDatabase;

    /**
     * The frontend is a separate single-page app, so there is no "login" page to redirect to.
     * Every protected endpoint must answer with 401 rather than a server error.
     */
    public function test_protected_endpoints_return_401_without_a_token(): void
    {
        $endpoints = [
            '/api/v1/notifications',
            '/api/v1/notifications/unread-count',
            '/api/v1/notifications/push/key',
            '/api/v1/patients',
            '/api/v1/appointments',
            '/api/v1/dashboard/summary',
            '/api/v1/users',
        ];

        foreach ($endpoints as $endpoint) {
            $this->getJson($endpoint)->assertUnauthorized();
        }
    }

    public function test_protected_endpoints_return_401_with_an_invalid_token(): void
    {
        $this->withToken('not-a-real-token')->getJson('/api/v1/notifications')->assertUnauthorized();
    }

    public function test_login_itself_stays_public(): void
    {
        User::factory()->create(['role' => 'admin', 'email' => 'open@clinic.test', 'password' => 'Password123']);

        $this->postJson('/api/v1/login', ['login' => 'open@clinic.test', 'password' => 'Password123'])
            ->assertOk()
            ->assertJsonPath('data.user.role', 'admin');
    }
}
