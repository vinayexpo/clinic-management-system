<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;

class ClinicSetting extends Model
{
    protected $fillable = ['clinic_name', 'address', 'phone', 'email', 'logo_path', 'timezone', 'working_hours', 'appointment_slot_minutes', 'prescription_footer', 'invoice_prefix', 'receipt_prefix', 'theme'];

    protected $casts = ['working_hours' => 'array', 'theme' => 'array'];

    /**
     * Opening hours always leave this model keyed "0".."6". Without this, a sequential key set
     * is encoded as a JSON list and the weekday meaning is lost.
     */
    protected function serializeDays(array $hours): array
    {
        $days = [];
        foreach (range(0, 6) as $day) {
            $days[(string) $day] = $hours[$day] ?? $hours[(string) $day] ?? null;
        }

        return $days;
    }

    public function toArray(): array
    {
        $array = parent::toArray();
        if (is_array($array['working_hours'] ?? null)) {
            // Keep the object shape even when the sequence is 0..6 (JSON would otherwise be a list).
            $array['working_hours'] = (object) $this->serializeDays($array['working_hours']);
        }

        return $array;
    }

    /** Clinic opening hours in the clinic's timezone, or null when never configured. */
    public function isOpenAt(\DateTimeInterface $moment): ?bool
    {
        $hours = $this->working_hours;
        if (empty($hours)) {
            return null;
        }
        $local = CarbonImmutable::instance($moment)->setTimezone(config('app.timezone'));
        $entry = $hours[(string) $local->dayOfWeek] ?? null;
        if (! $entry) {
            return false;
        }
        $now = $local->format('H:i');

        return $now >= $entry['open'] && $now < $entry['close'];
    }
}
