<?php

namespace App\Support;

use App\Events\ApplicationInvalidated;
use App\Models\ClinicSetting;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Patient;
use App\Models\Payment;
use App\Models\Prescription;
use App\Models\PrescriptionItem;
use App\Models\User;
use App\Models\Visit;
use App\Models\VisitAmendment;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Notifications\DatabaseNotification;
use Illuminate\Support\Facades\Log;
use NotificationChannels\WebPush\PushSubscription;
use Throwable;

class ApplicationRealtime
{
    private bool $deliveryUnavailable = false;

    public function changed(Model $model): void
    {
        if ($this->deliveryUnavailable) {
            return;
        }

        try {
            $personal = $model instanceof DatabaseNotification || $model instanceof PushSubscription;
            $owner = $personal ? $model->getAttribute($model instanceof DatabaseNotification ? 'notifiable_id' : 'subscribable_id') : null;
            if ($personal && $model->getAttribute($model instanceof DatabaseNotification ? 'notifiable_type' : 'subscribable_type') !== (new User)->getMorphClass()) {
                return;
            }
            $userIds = $personal ? array_filter([(int) $owner]) : $this->patientUsers($model);
            $shared = $model instanceof ClinicSetting || $model instanceof Doctor || $model instanceof DoctorSchedule;
            $changedUserId = $model instanceof User ? (int) $model->getKey() : null;

            // Capture routing before deletes or reassignment; deliver only after the outer commit.
            $model->getConnection()->afterCommit(function () use ($userIds, $personal, $shared, $changedUserId): void {
                if ($this->deliveryUnavailable) {
                    return;
                }

                try {
                    User::query()->where(function (Builder $query) use ($changedUserId): void {
                        $query->where(fn (Builder $active) => $active->where('is_active', true)->whereIn('role', User::ROLES));
                        if ($changedUserId !== null) {
                            // Existing sockets must learn that their account has been revoked.
                            $query->orWhere('id', $changedUserId);
                        }
                    })
                        ->where(function (Builder $query) use ($userIds, $personal, $shared): void {
                            $query->whereIn('id', $userIds);
                            if (! $personal) {
                                $query->orWhereIn('role', ['admin', 'doctor', 'receptionist']);
                            }
                            if ($shared) {
                                $query->orWhere('role', 'patient');
                            }
                        })->select('id')->chunkById(100, function (Collection $users): void {
                            event(new ApplicationInvalidated($users->pluck('id')->map(fn (int|string $id): int => (int) $id)->all()));
                        });
                } catch (Throwable) {
                    $this->deliveryUnavailable = true;
                    // Never log transport exceptions: they can contain signed URLs and credentials.
                    Log::warning('Realtime invalidation delivery unavailable.');
                }
            });
        } catch (Throwable) {
            Log::warning('Realtime invalidation scheduling unavailable.');
        }
    }

    /** @return list<int> */
    private function patientUsers(Model $model): array
    {
        if ($model instanceof User || $model instanceof Patient) {
            $key = $model instanceof User ? 'id' : 'user_id';

            return array_values(array_unique(array_filter([(int) $model->getAttribute($key), (int) $model->getRawOriginal($key)])));
        }

        if ($model instanceof InvoiceItem || $model instanceof Payment) {
            $parent = Invoice::find($model->getAttribute('invoice_id'));
        } elseif ($model instanceof PrescriptionItem) {
            $parent = Prescription::find($model->getAttribute('prescription_id'));
        } elseif ($model instanceof VisitAmendment) {
            $parent = Visit::find($model->getAttribute('visit_id'));
        } else {
            $parent = $model;
        }

        $patientIds = array_filter([$parent?->getAttribute('patient_id'), $parent?->getRawOriginal('patient_id')]);
        if ($patientIds === []) {
            return [];
        }

        return Patient::withTrashed()->whereIn('id', $patientIds)->whereNotNull('user_id')->pluck('user_id')->map(fn (int|string $id): int => (int) $id)->all();
    }
}
