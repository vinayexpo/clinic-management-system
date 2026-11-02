<?php

namespace App\Support;

use App\Models\Doctor;
use App\Models\Patient;
use App\Models\User;
use App\Notifications\ClinicNotification;
use Illuminate\Support\Collection;
use Throwable;

/**
 * Delivers clinic notifications to staff and patients. Delivery failures are reported
 * but never interrupt the clinical or administrative action that triggered them.
 */
class ClinicNotifications
{
    /**
     * @param  iterable<User>  $users
     */
    public function notifyUsers(iterable $users, string $title, string $body, string $type, string $page = 'Dashboard', ?int $entityId = null): void
    {
        foreach ($users as $user) {
            if (! $user instanceof User || ! $user->is_active) {
                continue;
            }

            $this->send($user, $title, $body, $type, $page, $entityId);
        }
    }

    public function notifyRoles(array $roles, string $title, string $body, string $type, string $page = 'Dashboard', ?int $entityId = null): void
    {
        $users = User::query()
            ->whereIn('role', $roles)
            ->where('is_active', true)
            ->get();

        $this->notifyUsers($users, $title, $body, $type, $page, $entityId);
    }

    public function notifyDoctor(Doctor|int|null $doctor, string $title, string $body, string $type, string $page = 'Dashboard', ?int $entityId = null): void
    {
        $model = $doctor instanceof Doctor ? $doctor : ($doctor ? Doctor::find($doctor) : null);
        $user = $model?->user;

        if ($user) {
            $this->send($user, $title, $body, $type, $page, $entityId);
        }
    }

    public function notifyPatient(Patient $patient, string $title, string $body, string $type, string $page = 'Dashboard', ?int $entityId = null): void
    {
        $user = $patient->user;

        if ($user) {
            $this->send($user, $title, $body, $type, $page, $entityId, $patient->id);
        }
    }

    /**
     * @param  Collection<int, User>  $users
     */
    public function notifyMany(Collection $users, string $title, string $body, string $type, string $page = 'Dashboard', ?int $entityId = null): void
    {
        $this->notifyUsers($users, $title, $body, $type, $page, $entityId);
    }

    private function send(User $user, string $title, string $body, string $type, string $page, ?int $entityId, ?int $patientId = null): void
    {
        try {
            $user->notify(new ClinicNotification($title, $body, $type, $page, $entityId, $patientId));
        } catch (Throwable $e) {
            report($e);
        }
    }
}
