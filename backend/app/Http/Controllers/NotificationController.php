<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\Visit;
use App\Support\ApiHelpers;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Minishlink\WebPush\ContentEncoding;

class NotificationController extends Controller
{
    use ApiHelpers;

    /**
     * The signed-in user's notifications, newest first.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $perPage = min(50, max(1, $request->integer('per_page', 20)));

        if ($user->role === 'patient') {
            $patient = Patient::where('user_id', $user->id)->first();
            if (! $patient) {
                return $this->ok(new LengthAwarePaginator([], 0, $perPage, 1, [
                    'path' => $request->url(),
                    'query' => $request->query(),
                ]));
            }

            $all = $user->notifications()
                ->latest()
                ->get()
                ->filter(fn ($n) => $this->isNotificationForPatient($n, $patient))
                ->values();

            $page = max(1, $request->integer('page', 1));
            $paged = new LengthAwarePaginator(
                $all->forPage($page, $perPage)->values(),
                $all->count(),
                $perPage,
                $page,
                ['path' => $request->url(), 'query' => $request->query()]
            );

            $paged->getCollection()->transform(fn ($n) => $this->transformNotification($n));

            return $this->ok($paged);
        }

        $notifications = $user->notifications()
            ->latest()
            ->paginate($perPage);

        $notifications->getCollection()->transform(fn ($n) => $this->transformNotification($n));

        return $this->ok($notifications);
    }

    public function unreadCount(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->role === 'patient') {
            $patient = Patient::where('user_id', $user->id)->first();
            if (! $patient) {
                return $this->ok(['unread' => 0]);
            }

            $unread = $user->unreadNotifications
                ->filter(fn ($n) => $this->isNotificationForPatient($n, $patient))
                ->count();

            return $this->ok(['unread' => $unread]);
        }

        return $this->ok(['unread' => $request->user()->unreadNotifications()->count()]);
    }

    public function markAsRead(Request $request, string $notification): JsonResponse
    {
        $user = $request->user();
        $item = $user->notifications()->whereKey($notification)->first();
        abort_if($item === null, 404, 'Notification not found.');

        if ($user->role === 'patient') {
            $patient = Patient::where('user_id', $user->id)->first();
            abort_unless($patient && $this->isNotificationForPatient($item, $patient), 403, 'Notification not found.');
        }

        $item->markAsRead();

        return $this->unreadCount($request);
    }

    public function markAllAsRead(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->role === 'patient') {
            $patient = Patient::where('user_id', $user->id)->first();
            if ($patient) {
                $user->unreadNotifications
                    ->filter(fn ($n) => $this->isNotificationForPatient($n, $patient))
                    ->markAsRead();
            }

            return $this->ok(['unread' => 0]);
        }

        $request->user()->unreadNotifications->markAsRead();

        return $this->ok(['unread' => 0]);
    }

    public function destroy(Request $request, string $notification): JsonResponse
    {
        $user = $request->user();
        $item = $user->notifications()->whereKey($notification)->first();
        abort_if($item === null, 404, 'Notification not found.');

        if ($user->role === 'patient') {
            $patient = Patient::where('user_id', $user->id)->first();
            abort_unless($patient && $this->isNotificationForPatient($item, $patient), 403, 'Notification not found.');
        }

        $item->delete();

        return $this->ok(['message' => 'Notification removed.']);
    }

    private function transformNotification($notification): array
    {
        $data = $notification->data;

        return [
            'id' => $notification->id,
            'title' => $data['title'] ?? 'Notification',
            'body' => $data['body'] ?? '',
            'type' => $data['type'] ?? 'general',
            'page' => $data['page'] ?? 'Dashboard',
            'entity_id' => $data['entity_id'] ?? null,
            'patient_id' => $data['patient_id'] ?? null,
            'read_at' => $notification->read_at?->toIso8601String(),
            'created_at' => $notification->created_at?->toIso8601String(),
        ];
    }

    private function isNotificationForPatient($notification, Patient $patient): bool
    {
        $data = $notification->data;
        if (isset($data['patient_id'])) {
            return (int) $data['patient_id'] === (int) $patient->id;
        }

        $type = (string) ($data['type'] ?? '');
        $entityId = $data['entity_id'] ?? null;

        if ($entityId) {
            if (str_starts_with($type, 'appointment')) {
                return Appointment::where('id', $entityId)->where('patient_id', $patient->id)->exists();
            }
            if (str_starts_with($type, 'visit')) {
                return Visit::where('id', $entityId)->where('patient_id', $patient->id)->exists();
            }
            if (str_starts_with($type, 'prescription')) {
                return Prescription::where('id', $entityId)->where('patient_id', $patient->id)->exists();
            }
            if (str_starts_with($type, 'invoice') || str_starts_with($type, 'payment')) {
                return Invoice::where('id', $entityId)->where('patient_id', $patient->id)->exists();
            }
        }

        return false;
    }

    /**
     * The VAPID public key the browser needs in order to subscribe.
     */
    public function pushKey(Request $request): JsonResponse
    {
        $publicKey = (string) config('webpush.vapid.public_key');

        return $this->ok([
            'public_key' => $publicKey,
            'enabled' => $publicKey !== '',
            'subscribed' => $request->user()->pushSubscriptions()->count() > 0,
        ]);
    }

    /**
     * Store a browser push subscription for the signed-in user.
     */
    public function subscribe(Request $request): JsonResponse
    {
        $data = $request->validate([
            'endpoint' => 'required|string|max:1024',
            'keys.p256dh' => 'required|string|max:255',
            'keys.auth' => 'required|string|max:255',
            'content_encoding' => 'nullable|string|in:aes128gcm,aesgcm',
        ]);

        $encoding = null;
        if (! empty($data['content_encoding'])) {
            $encoding = ContentEncoding::tryFrom($data['content_encoding']);
        }

        $request->user()->updatePushSubscription(
            $data['endpoint'],
            $data['keys']['p256dh'],
            $data['keys']['auth'],
            $encoding,
        );

        return $this->ok(['subscribed' => true]);
    }

    public function unsubscribe(Request $request): JsonResponse
    {
        $data = $request->validate(['endpoint' => 'required|string|max:1024']);

        $request->user()->pushSubscriptions()->where('endpoint', $data['endpoint'])->get()->each->delete();

        return $this->ok(['subscribed' => false]);
    }
}
