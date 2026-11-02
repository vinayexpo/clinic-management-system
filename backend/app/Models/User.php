<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use NotificationChannels\WebPush\HasPushSubscriptions;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasPushSubscriptions, Notifiable;

    protected $fillable = ['name', 'email', 'phone', 'password', 'role', 'is_active', 'avatar_path'];

    protected $hidden = ['password', 'remember_token', 'avatar_path'];

    protected $appends = ['has_avatar'];

    /** Roles: staff (admin, doctor, receptionist) and portal patients. */
    public const ROLES = ['admin', 'doctor', 'receptionist', 'patient'];

    public function patient(): HasOne
    {
        return $this->hasOne(Patient::class);
    }

    public function getHasAvatarAttribute(): bool
    {
        return ! empty($this->avatar_path);
    }

    public function doctor(): HasOne
    {
        return $this->hasOne(Doctor::class);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean', 'last_login_at' => 'datetime',
        ];
    }
}
