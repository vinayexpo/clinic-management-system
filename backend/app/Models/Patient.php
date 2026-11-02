<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Patient extends Model
{
    use SoftDeletes;

    protected $fillable = ['user_id', 'patient_number', 'first_name', 'last_name', 'date_of_birth', 'sex', 'phone', 'email', 'address', 'emergency_contact_name', 'emergency_contact_phone', 'allergies_summary', 'created_by', 'avatar_path', 'whatsapp_opt_in'];

    // The linked user is hidden from JSON; only the sign-in phone is exposed, and only when loaded.
    protected $hidden = ['avatar_path', 'user'];

    protected $appends = ['has_avatar', 'has_login', 'login_phone'];

    public function getHasLoginAttribute(): bool
    {
        return ! is_null($this->user_id);
    }

    public function getLoginPhoneAttribute(): ?string
    {
        return $this->relationLoaded('user') ? $this->user?->phone : null;
    }

    protected $casts = ['date_of_birth' => 'date', 'whatsapp_opt_in' => 'boolean'];

    public function getHasAvatarAttribute(): bool
    {
        return ! empty($this->avatar_path);
    }

    public function appointments(): HasMany
    {
        return $this->hasMany(Appointment::class);
    }

    public function visits(): HasMany
    {
        return $this->hasMany(Visit::class);
    }

    public function prescriptions(): HasMany
    {
        return $this->hasMany(Prescription::class);
    }

    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
