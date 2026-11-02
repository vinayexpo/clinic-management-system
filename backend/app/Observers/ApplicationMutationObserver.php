<?php

namespace App\Observers;

use App\Models\User;
use App\Support\ApplicationRealtime;
use Illuminate\Database\Eloquent\Model;

class ApplicationMutationObserver
{
    public function created(Model $model): void
    {
        app(ApplicationRealtime::class)->changed($model);
    }

    public function updated(Model $model): void
    {
        $changes = array_diff(array_keys($model->getChanges()), ['updated_at']);
        if ($model instanceof User) {
            $changes = array_diff($changes, ['last_login_at', 'remember_token']);
        }
        if ($changes === []) {
            return;
        }

        app(ApplicationRealtime::class)->changed($model);
    }

    public function deleted(Model $model): void
    {
        app(ApplicationRealtime::class)->changed($model);
    }
}
