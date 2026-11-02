<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Appointment extends Model
{
    protected $fillable = ['appointment_number', 'patient_id', 'doctor_id', 'appointment_date', 'start_time', 'end_time', 'visit_type', 'token_number', 'status', 'reason_for_visit', 'cancel_reason', 'reminder_sent_at', 'reminder_kind', 'created_by'];

    protected $casts = ['appointment_date' => 'date', 'reminder_sent_at' => 'datetime'];

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function visit(): HasOne
    {
        return $this->hasOne(Visit::class);
    }
}
