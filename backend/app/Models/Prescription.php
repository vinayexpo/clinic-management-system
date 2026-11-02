<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Prescription extends Model
{
    protected $fillable = ['prescription_number', 'visit_id', 'patient_id', 'doctor_id', 'issued_at', 'instructions', 'status'];

    protected $casts = ['issued_at' => 'datetime'];

    public function items(): HasMany
    {
        return $this->hasMany(PrescriptionItem::class);
    }

    public function visit(): BelongsTo
    {
        return $this->belongsTo(Visit::class);
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }
}
