<?php

use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('users.{userId}', function (User $user, string $userId): bool {
    return $user->is_active && in_array($user->role, User::ROLES, true)
        && (string) $user->id === $userId;
}, ['guards' => ['sanctum']]);
