<?php

namespace Tests\Feature;

use App\Models\Doctor;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DoctorScheduleTest extends TestCase
{
    use RefreshDatabase;

    private function doctor(): Doctor
    {
        $user = User::factory()->create(['role' => 'doctor']);

        return Doctor::create(['user_id' => $user->id, 'display_name' => 'Dr Week', 'consultation_fee' => 500, 'is_active' => true]);
    }

    private function token(string $role): string
    {
        return User::factory()->create(['role' => $role])->createToken('test')->plainTextToken;
    }

    public function test_admin_replaces_weekly_schedule_atomically(): void
    {
        $doctor = $this->doctor();
        $token = $this->token('admin');

        $this->withToken($token)->putJson("/api/v1/doctors/{$doctor->id}/schedules", [
            'blocks' => [
                ['day_of_week' => 1, 'start_time' => '09:00', 'end_time' => '13:00'],
                ['day_of_week' => 1, 'start_time' => '17:00', 'end_time' => '20:00'],
                ['day_of_week' => 6, 'start_time' => '10:00', 'end_time' => '14:00'],
            ],
        ])->assertOk()->assertJsonCount(3, 'data');

        $this->assertSame(3, $doctor->schedules()->count());

        // Replacing with a smaller week removes the old rows.
        $this->withToken($token)->putJson("/api/v1/doctors/{$doctor->id}/schedules", [
            'blocks' => [['day_of_week' => 2, 'start_time' => '08:00', 'end_time' => '12:00']],
        ])->assertOk()->assertJsonCount(1, 'data');

        $this->assertSame(1, $doctor->schedules()->count());
    }

    public function test_empty_blocks_clears_the_schedule(): void
    {
        $doctor = $this->doctor();
        $token = $this->token('admin');
        $this->withToken($token)->putJson("/api/v1/doctors/{$doctor->id}/schedules", [
            'blocks' => [['day_of_week' => 3, 'start_time' => '09:00', 'end_time' => '12:00']],
        ])->assertOk();

        $this->withToken($token)->putJson("/api/v1/doctors/{$doctor->id}/schedules", ['blocks' => []])
            ->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_overlapping_blocks_on_same_day_are_rejected_and_nothing_is_saved(): void
    {
        $doctor = $this->doctor();
        $token = $this->token('admin');
        $this->withToken($token)->putJson("/api/v1/doctors/{$doctor->id}/schedules", [
            'blocks' => [['day_of_week' => 4, 'start_time' => '09:00', 'end_time' => '12:00']],
        ])->assertOk();

        $this->withToken($token)->putJson("/api/v1/doctors/{$doctor->id}/schedules", [
            'blocks' => [
                ['day_of_week' => 4, 'start_time' => '09:00', 'end_time' => '12:00'],
                ['day_of_week' => 4, 'start_time' => '11:30', 'end_time' => '13:00'],
            ],
        ])->assertStatus(422);

        // The earlier valid schedule is untouched.
        $this->assertSame(1, $doctor->schedules()->count());
    }

    public function test_block_ending_before_it_starts_is_rejected(): void
    {
        $doctor = $this->doctor();

        $this->withToken($this->token('admin'))->putJson("/api/v1/doctors/{$doctor->id}/schedules", [
            'blocks' => [['day_of_week' => 5, 'start_time' => '14:00', 'end_time' => '09:00']],
        ])->assertStatus(422);
    }

    public function test_back_to_back_blocks_are_allowed(): void
    {
        $doctor = $this->doctor();

        $this->withToken($this->token('admin'))->putJson("/api/v1/doctors/{$doctor->id}/schedules", [
            'blocks' => [
                ['day_of_week' => 5, 'start_time' => '09:00', 'end_time' => '12:00'],
                ['day_of_week' => 5, 'start_time' => '12:00', 'end_time' => '15:00'],
            ],
        ])->assertOk();
    }

    public function test_receptionist_cannot_change_working_hours(): void
    {
        $doctor = $this->doctor();

        $this->withToken($this->token('receptionist'))->putJson("/api/v1/doctors/{$doctor->id}/schedules", [
            'blocks' => [['day_of_week' => 1, 'start_time' => '09:00', 'end_time' => '10:00']],
        ])->assertForbidden();
    }

    public function test_invalid_day_is_rejected(): void
    {
        $doctor = $this->doctor();

        $this->withToken($this->token('admin'))->putJson("/api/v1/doctors/{$doctor->id}/schedules", [
            'blocks' => [['day_of_week' => 9, 'start_time' => '09:00', 'end_time' => '10:00']],
        ])->assertStatus(422)->assertJsonValidationErrors(['blocks.0.day_of_week']);
    }
}
