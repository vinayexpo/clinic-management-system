<?php

namespace App\Console\Commands;

use App\Models\Appointment;
use App\Support\WhatsAppDispatcher;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;

/**
 * Sends the automatic appointment reminder over WhatsApp.
 *
 * Reminders are sent once per appointment: the appointment row records when the
 * reminder went out, so running the command repeatedly never double-messages a
 * patient. Appointments outside the doctor's configured working hours are skipped.
 */
class SendAppointmentReminders extends Command
{
    protected $signature = 'clinic:whatsapp-reminders';

    protected $description = 'Send WhatsApp reminders for upcoming appointments that have not been reminded yet.';

    public function handle(WhatsAppDispatcher $dispatcher): int
    {
        if (! config('whatsapp.enabled')) {
            $this->info('WhatsApp reminders are disabled; nothing to send.');

            return self::SUCCESS;
        }

        $leadHours = (int) config('whatsapp.reminder_lead_hours', 24);
        $now = CarbonImmutable::now();
        $horizon = $now->addHours((int) config('whatsapp.reminder_lookahead_hours', 26));

        $appointments = Appointment::query()
            ->with(['patient', 'doctor.schedules'])
            ->whereIn('status', ['booked', 'waiting'])
            ->whereNull('reminder_sent_at')
            ->whereDate('appointment_date', '>=', $now->toDateString())
            ->whereDate('appointment_date', '<=', $horizon->toDateString())
            ->get();

        $sent = 0;
        $skipped = 0;

        foreach ($appointments as $appointment) {
            $start = $this->startAt($appointment);

            if (! $start || $start->isPast() || $start->diffInMinutes($now) > $leadHours * 60) {
                $skipped++;

                continue;
            }

            if (! $this->withinDoctorHours($appointment, $start)) {
                $skipped++;

                continue;
            }

            $values = $dispatcher->values($appointment->patient, $appointment);
            $result = $dispatcher->send($appointment->patient, 'appointment_reminder', $values, $appointment);

            if (in_array($result['status'], ['sent', 'logged'], true)) {
                $appointment->update(['reminder_sent_at' => now(), 'reminder_kind' => $leadHours.'h']);
                $sent++;
                $this->line("Reminder sent for {$appointment->appointment_number} ({$appointment->patient->first_name})");
            } else {
                $skipped++;
                $this->warn("Reminder skipped for {$appointment->appointment_number}: ".($result['error'] ?? 'unknown reason'));
            }
        }

        $this->info("Checked {$appointments->count()} appointment(s): {$sent} reminded, {$skipped} skipped.");

        return self::SUCCESS;
    }

    private function startAt(Appointment $appointment): ?CarbonImmutable
    {
        if (! $appointment->appointment_date || ! $appointment->start_time) {
            return null;
        }

        $time = substr((string) $appointment->start_time, 0, 5);

        return CarbonImmutable::parse($appointment->appointment_date->format('Y-m-d').' '.$time);
    }

    /**
     * When the doctor has working hours configured, only remind inside them.
     */
    private function withinDoctorHours(Appointment $appointment, CarbonImmutable $start): bool
    {
        if (! config('whatsapp.respect_doctor_schedule')) {
            return true;
        }

        $schedules = $appointment->doctor?->schedules ?? new Collection;
        $active = $schedules->where('is_active', true)
            ->filter(fn ($s) => $s->day_of_week === $start->dayOfWeek);

        // No schedule configured means the doctor has not published hours; do not block the reminder.
        if ($active->isEmpty()) {
            return true;
        }

        $day = $start->format('Y-m-d');

        return $active->contains(function ($schedule) use ($day, $start): bool {
            $from = CarbonImmutable::parse($day.' '.substr((string) $schedule->start_time, 0, 5));
            $to = CarbonImmutable::parse($day.' '.substr((string) $schedule->end_time, 0, 5));

            return $start >= $from && $start <= $to;
        });
    }
}
