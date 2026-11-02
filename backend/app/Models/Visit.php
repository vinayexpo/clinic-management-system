<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Visit extends Model
{
    protected $fillable = ['visit_number', 'patient_id', 'appointment_id', 'doctor_id', 'visit_date', 'symptoms', 'vitals', 'examination_notes', 'diagnosis', 'treatment_plan', 'follow_up_date', 'status', 'finalized_at', 'created_by'];

    protected $casts = ['visit_date' => 'date', 'vitals' => 'array', 'follow_up_date' => 'date', 'finalized_at' => 'datetime'];

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function appointment(): BelongsTo
    {
        return $this->belongsTo(Appointment::class);
    }

    public function prescriptions(): HasMany
    {
        return $this->hasMany(Prescription::class);
    }

    public function amendments(): HasMany
    {
        return $this->hasMany(VisitAmendment::class)->latest();
    }

    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class);
    }
}
