<?php

namespace App\Http\Controllers;

use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Support\ApiHelpers;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Weekly working hours for a doctor. Each row is one working block on one weekday
 * (day_of_week: 0 = Sunday ... 6 = Saturday). Admin-only; the whole week is replaced atomically.
 */
class DoctorScheduleController extends Controller
{
    use ApiHelpers;

    private const MAX_BLOCKS = 70;

    public function index(Request $request, Doctor $doctor): JsonResponse
    {
        $this->requireRole($request, 'admin', 'doctor', 'receptionist', 'patient');

        return $this->ok($doctor->schedules()->orderBy('day_of_week')->orderBy('start_time')->get());
    }

    /**
     * Replace the complete weekly schedule. Body: { "blocks": [ {day_of_week, start_time, end_time}, ... ] }.
     * An empty list clears the schedule.
     */
    public function replace(Request $request, Doctor $doctor): JsonResponse
    {
        $this->requireRole($request, 'admin');

        $data = $request->validate([
            'blocks' => 'present|array|max:'.self::MAX_BLOCKS,
            'blocks.*.day_of_week' => 'required|integer|between:0,6',
            'blocks.*.start_time' => 'required|date_format:H:i',
            'blocks.*.end_time' => 'required|date_format:H:i',
        ]);

        $blocks = collect($data['blocks'])
            ->map(fn (array $b) => ['day_of_week' => (int) $b['day_of_week'], 'start_time' => $b['start_time'], 'end_time' => $b['end_time']])
            ->sortBy([['day_of_week', 'asc'], ['start_time', 'asc']])
            ->values();

        $this->assertValid($blocks->all());

        $saved = DB::transaction(function () use ($doctor, $blocks, $request) {
            $doctor->schedules()->get()->each->delete();

            foreach ($blocks as $block) {
                DoctorSchedule::create($block + ['doctor_id' => $doctor->id, 'is_active' => true]);
            }

            $this->audit($request, 'updated', 'doctor_schedule', $doctor->id, 'Weekly working hours replaced ('.$blocks->count().' blocks).');

            return $doctor->schedules()->orderBy('day_of_week')->orderBy('start_time')->get();
        });

        return $this->ok($saved);
    }

    /**
     * Each block must end after it starts, and blocks on the same day must not overlap.
     * Times are zero-padded HH:MM, so string comparison matches clock order.
     *
     * @param  list<array{day_of_week:int,start_time:string,end_time:string}>  $blocks  sorted by day, then start
     */
    private function assertValid(array $blocks): void
    {
        foreach ($blocks as $index => $block) {
            abort_unless($block['start_time'] < $block['end_time'], 422, 'Each block must end after it starts.');

            $next = $blocks[$index + 1] ?? null;
            if ($next && $next['day_of_week'] === $block['day_of_week']) {
                abort_if($next['start_time'] < $block['end_time'], 422, 'Working blocks on the same day must not overlap.');
            }
        }
    }
}
