<?php

namespace Tests\Feature;

use App\Models\ClinicSetting;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClinicHoursTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): string
    {
        return User::factory()->create(['role' => 'admin'])->createToken('test')->plainTextToken;
    }

    private function hours(): array
    {
        return [
            '0' => null,
            '1' => ['open' => '09:00', 'close' => '20:00'],
            '2' => ['open' => '09:00', 'close' => '20:00'],
            '3' => ['open' => '09:00', 'close' => '20:00'],
            '4' => ['open' => '09:00', 'close' => '20:00'],
            '5' => ['open' => '09:00', 'close' => '20:00'],
            '6' => ['open' => '09:00', 'close' => '14:00'],
        ];
    }

    public function test_admin_saves_clinic_hours_and_they_round_trip(): void
    {
        $token = $this->admin();

        $this->withToken($token)->putJson('/api/v1/settings/clinic', [
            'clinic_name' => 'Carehaven', 'working_hours' => $this->hours(),
        ])->assertOk()->assertJsonPath('data.working_hours.1.close', '20:00');

        $this->withToken($token)->getJson('/api/v1/settings/clinic')
            ->assertOk()->assertJsonPath('data.working_hours.6.close', '14:00');
    }

    public function test_opening_after_closing_is_rejected(): void
    {
        $hours = $this->hours();
        $hours['2'] = ['open' => '21:00', 'close' => '09:00'];

        $this->withToken($this->admin())->putJson('/api/v1/settings/clinic', [
            'clinic_name' => 'Carehaven', 'working_hours' => $hours,
        ])->assertStatus(422);
    }

    public function test_timezone_is_fixed_to_ist_and_not_client_configurable(): void
    {
        $this->withToken($this->admin())->putJson('/api/v1/settings/clinic', [
            'clinic_name' => 'Carehaven', 'timezone' => 'America/New_York',
        ])->assertStatus(422)->assertJsonValidationErrors(['timezone']);

        $this->withToken($this->admin())->putJson('/api/v1/settings/clinic', [
            'clinic_name' => 'Carehaven',
        ])->assertOk()->assertJsonPath('data.timezone', 'Asia/Kolkata');
    }

    public function test_app_timezone_is_ist(): void
    {
        $this->assertSame('Asia/Kolkata', config('app.timezone'));
    }

    public function test_open_now_follows_hours_in_clinic_timezone(): void
    {
        $setting = new ClinicSetting(['timezone' => 'Asia/Kolkata', 'working_hours' => $this->hours()]);

        // Monday 10:00 IST = 04:30 UTC: open.
        $this->assertTrue($setting->isOpenAt(CarbonImmutable::parse('2026-10-12 04:30:00', 'UTC')));
        // Monday 21:00 IST = 15:30 UTC: closed after 20:00.
        $this->assertFalse($setting->isOpenAt(CarbonImmutable::parse('2026-10-12 15:30:00', 'UTC')));
        // Sunday is closed all day.
        $this->assertFalse($setting->isOpenAt(CarbonImmutable::parse('2026-10-11 05:00:00', 'UTC')));
    }

    public function test_open_status_is_unknown_when_hours_not_configured(): void
    {
        $setting = new ClinicSetting(['timezone' => 'Asia/Kolkata', 'working_hours' => null]);

        $this->assertNull($setting->isOpenAt(CarbonImmutable::now()));
    }
}
