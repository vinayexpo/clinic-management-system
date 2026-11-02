<?php

namespace Tests\Feature;

use App\Models\ClinicSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClinicThemeTest extends TestCase
{
    use RefreshDatabase;

    private function adminToken(): string
    {
        return User::factory()->create(['role' => 'admin'])->createToken('test')->plainTextToken;
    }

    public function test_an_administrator_saves_the_clinic_colours(): void
    {
        $token = $this->adminToken();

        $this->withToken($token)
            ->putJson('/api/v1/settings/clinic', [
                'clinic_name' => 'Carehaven',
                'theme' => ['primary' => '#7c3aed', 'accent' => '#c87949', 'background' => '#f5f7f4', 'surface' => '#ffffff'],
            ])
            ->assertOk()
            ->assertJsonPath('data.theme.primary', '#7c3aed');

        $this->assertSame('#7c3aed', ClinicSetting::query()->first()->theme['primary']);
    }

    public function test_saving_other_settings_keeps_the_colours(): void
    {
        $token = $this->adminToken();
        $this->withToken($token)->putJson('/api/v1/settings/clinic', [
            'clinic_name' => 'Carehaven',
            'theme' => ['primary' => '#7c3aed', 'accent' => '#c87949', 'background' => '#f5f7f4', 'surface' => '#ffffff'],
        ])->assertOk();

        $this->withToken($token)->putJson('/api/v1/settings/clinic', ['clinic_name' => 'Carehaven Clinic'])->assertOk();

        $this->assertSame('#7c3aed', ClinicSetting::query()->first()->theme['primary']);
    }

    public function test_an_invalid_colour_is_rejected(): void
    {
        $token = $this->adminToken();

        $this->withToken($token)
            ->putJson('/api/v1/settings/clinic', [
                'clinic_name' => 'Carehaven',
                'theme' => ['primary' => 'teal', 'accent' => '#c87949', 'background' => '#f5f7f4', 'surface' => '#ffffff'],
            ])
            ->assertUnprocessable();
    }

    public function test_the_colours_are_public_for_the_sign_in_screen(): void
    {
        $token = $this->adminToken();
        $this->withToken($token)->putJson('/api/v1/settings/clinic', [
            'clinic_name' => 'Carehaven',
            'theme' => ['primary' => '#7c3aed', 'accent' => '#c87949', 'background' => '#f5f7f4', 'surface' => '#ffffff'],
        ])->assertOk();

        $this->getJson('/api/v1/setup/status')
            ->assertOk()
            ->assertJsonPath('data.theme.primary', '#7c3aed');
    }

    public function test_only_administrators_can_change_the_colours(): void
    {
        $receptionist = User::factory()->create(['role' => 'receptionist']);
        $token = $receptionist->createToken('test')->plainTextToken;

        $this->withToken($token)
            ->putJson('/api/v1/settings/clinic', [
                'clinic_name' => 'Carehaven',
                'theme' => ['primary' => '#7c3aed', 'accent' => '#c87949', 'background' => '#f5f7f4', 'surface' => '#ffffff'],
            ])
            ->assertForbidden();
    }
}
