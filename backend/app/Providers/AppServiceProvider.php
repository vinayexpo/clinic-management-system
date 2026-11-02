<?php

namespace App\Providers;

use App\Models\AiSetting;
use App\Models\Appointment;
use App\Models\AuditLog;
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
use App\Models\WhatsAppConnection;
use App\Models\WhatsAppMessage;
use App\Models\WhatsAppMetaTemplate;
use App\Models\WhatsAppTemplate;
use App\Models\WhatsAppWebhookEvent;
use App\Observers\ApplicationMutationObserver;
use App\Support\ApplicationRealtime;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Notifications\ChannelManager;
use Illuminate\Notifications\DatabaseNotification;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use NotificationChannels\WebPush\Events\NotificationFailed;
use NotificationChannels\WebPush\Events\NotificationSent;
use NotificationChannels\WebPush\PushSubscription;
use NotificationChannels\WebPush\WebPushChannel;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->scoped(ApplicationRealtime::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        foreach ([
            AiSetting::class, Appointment::class, AuditLog::class,
            ClinicSetting::class, Doctor::class, DoctorSchedule::class,
            Invoice::class, InvoiceItem::class, Patient::class,
            Payment::class, Prescription::class, PrescriptionItem::class,
            User::class, Visit::class, VisitAmendment::class,
            WhatsAppConnection::class, WhatsAppMessage::class,
            WhatsAppMetaTemplate::class, WhatsAppTemplate::class,
            WhatsAppWebhookEvent::class, DatabaseNotification::class,
            PushSubscription::class,
        ] as $model) {
            $model::observe(ApplicationMutationObserver::class);
        }

        // Register the browser push channel so notifications can use via() => ['database', 'webpush'].
        Notification::resolved(function (ChannelManager $manager): void {
            $manager->extend('webpush', fn ($app) => $app->make(WebPushChannel::class));
        });

        RateLimiter::for('login', function (Request $request): Limit {
            $identifier = strtolower(trim((string) ($request->input('login') ?? $request->input('email') ?? 'unknown')));

            return Limit::perMinute(10)->by((string) $request->ip().'|'.$identifier);
        });

        // Browser push delivery outcomes are otherwise invisible; record them for operations.
        Event::listen(NotificationSent::class, function (NotificationSent $event): void {
            Log::info('Push notification delivered.', [
                'user_id' => $event->subscription->subscribable_id,
                'endpoint' => $event->subscription->endpoint,
            ]);
        });

        Event::listen(NotificationFailed::class, function (NotificationFailed $event): void {
            Log::warning('Push notification failed.', [
                'user_id' => $event->subscription->subscribable_id,
                'endpoint' => $event->subscription->endpoint,
                'reason' => $event->report->getReason(),
            ]);
        });
    }
}
