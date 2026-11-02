<?php

use App\Console\Commands\SendAppointmentReminders;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
|--------------------------------------------------------------------------
| WhatsApp appointment reminders
|--------------------------------------------------------------------------
|
| Runs every fifteen minutes and reminds patients about appointments that are
| coming up. The appointment row records the reminder, so a patient is never
| messaged twice for the same visit. Requires a queue worker only when
| WHATSAPP_QUEUE is enabled.
|
*/

Schedule::command(SendAppointmentReminders::class)
    ->everyFifteenMinutes()
    ->withoutOverlapping()
    ->runInBackground();
