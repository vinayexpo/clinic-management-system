<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;
use NotificationChannels\WebPush\WebPushMessage;

/**
 * A clinic notification delivered to the in-app notification centre and, when the
 * user has subscribed, as a browser push message.
 */
class ClinicNotification extends Notification
{
    use Queueable;

    /**
     * @param  string  $title  Short headline shown in the list and the push banner.
     * @param  string  $body  One sentence of supporting detail.
     * @param  string  $type  Stable event key such as "appointment.booked".
     * @param  string  $page  Frontend destination the notification links to.
     * @param  int|null  $entityId  Identifier of the record the event refers to.
     */
    public function __construct(
        public readonly string $title,
        public readonly string $body,
        public readonly string $type,
        public readonly string $page = 'Dashboard',
        public readonly ?int $entityId = null,
        public readonly ?int $patientId = null,
    ) {}

    /**
     * @return list<string>
     */
    public function via(object $notifiable): array
    {
        return ['database', 'webpush'];
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(object $notifiable): array
    {
        return [
            'title' => $this->title,
            'body' => $this->body,
            'type' => $this->type,
            'page' => $this->page,
            'entity_id' => $this->entityId,
            'patient_id' => $this->patientId,
        ];
    }

    public function toWebPush(object $notifiable): WebPushMessage
    {
        return (new WebPushMessage)
            ->title($this->title)
            ->body($this->body)
            ->icon($this->iconUrl())
            ->badge($this->iconUrl())
            ->tag($this->type.'-'.($this->entityId ?? 'general'))
            ->renotify(false)
            ->data($this->toArray($notifiable) + ['url' => $this->targetUrl()]);
    }

    private function iconUrl(): string
    {
        return rtrim((string) config('app.frontend_url'), '/').'/push-icon.png';
    }

    private function targetUrl(): string
    {
        $base = rtrim((string) config('app.frontend_url'), '/');

        return $base.'/'.strtolower($this->page);
    }
}
