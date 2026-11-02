<?php

namespace App\Http\Controllers;

use App\Models\WhatsAppConnection;
use App\Models\WhatsAppWebhookEvent;
use App\Support\ApiHelpers;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use JsonException;
use stdClass;

class WhatsAppWebhookController extends Controller
{
    use ApiHelpers;

    private const FIELDS = ['smb_message_echoes', 'messages', 'smb_app_state_sync', 'history', 'account_update'];

    public function verify(Request $request): Response
    {
        $expected = config('whatsapp.webhook_verify_token');
        $token = $request->query('hub_verify_token', $request->query('hub.verify_token'));
        $mode = $request->query('hub_mode', $request->query('hub.mode'));
        $challenge = $request->query('hub_challenge', $request->query('hub.challenge'));

        abort_unless(is_string($expected) && $expected !== '' && is_string($token)
            && hash_equals($expected, $token) && $mode === 'subscribe' && is_string($challenge), 403);

        return response($challenge, 200)->header('Content-Type', 'text/plain; charset=UTF-8');
    }

    public function receive(Request $request): JsonResponse
    {
        $secret = config('whatsapp.app_secret');
        $signature = $request->header('X-Hub-Signature-256');
        $body = $request->getContent();

        abort_unless(is_string($secret) && $secret !== '' && is_string($signature)
            && preg_match('/\Asha256=[a-f0-9]{64}\z/D', $signature) === 1
            && hash_equals('sha256='.hash_hmac('sha256', $body, $secret), $signature), 403);

        try {
            $payload = json_decode($body, false, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            abort(400, 'Invalid JSON.');
        }

        if (! $payload instanceof stdClass || ($payload->object ?? null) !== 'whatsapp_business_account'
            || ! is_array($payload->entry ?? null)) {
            return response()->json(['received' => true]);
        }

        DB::transaction(function () use ($payload): void {
            $connection = WhatsAppConnection::query()->lockForUpdate()->find(1);
            if (! $connection || ! is_string($connection->waba_id) || $connection->waba_id === '') {
                return;
            }

            foreach ($payload->entry as $entry) {
                if (! $entry instanceof stdClass || ! is_scalar($entry->id ?? null)
                    || (string) $entry->id !== $connection->waba_id || ! is_array($entry->changes ?? null)) {
                    continue;
                }

                foreach ($entry->changes as $change) {
                    if (! $change instanceof stdClass || ! in_array($change->field ?? null, self::FIELDS, true)
                        || ! ($change->value ?? null) instanceof stdClass) {
                        continue;
                    }

                    $value = json_decode(json_encode($change->value, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
                    $phoneNumberId = data_get($value, 'metadata.phone_number_id');
                    if (array_key_exists('phone_number_id', (array) ($value['metadata'] ?? []))
                        && (! is_scalar($phoneNumberId) || (string) $phoneNumberId !== (string) $connection->phone_number_id)) {
                        continue;
                    }

                    $fingerprint = hash('sha256', json_encode([
                        $connection->waba_id, $change->field, $this->canonicalValue($change->value),
                    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                    $event = WhatsAppWebhookEvent::query()->firstOrCreate(['fingerprint' => $fingerprint], [
                        'waba_id' => $connection->waba_id,
                        'phone_number_id' => $phoneNumberId === null ? null : (string) $phoneNumberId,
                        'field' => $change->field,
                        'payload' => $value,
                        'received_at' => now(),
                    ]);

                    if (! $event->wasRecentlyCreated) {
                        // Lifecycle values can repeat after reconnecting; entry.time is not part of the fingerprint.
                        if ($change->field === 'account_update') {
                            $this->updateConnection($connection, $change->field, $value, $entry->time ?? null);
                            if ($connection->isDirty()) {
                                $connection->save();
                            }
                        }

                        continue;
                    }

                    $connection->last_webhook_at = $event->received_at;
                    $this->updateConnection($connection, $change->field, $value, $entry->time ?? null);
                    $connection->save();
                }
            }
        }, 3);

        return response()->json(['received' => true]);
    }

    public function events(Request $request): JsonResponse
    {
        $this->requireRole($request, 'admin');

        $connection = WhatsAppConnection::query()->find(1);
        $events = WhatsAppWebhookEvent::query()
            ->select(['id', 'waba_id', 'phone_number_id', 'field', 'payload', 'received_at'])
            ->where('waba_id', $connection?->waba_id ?? '')
            ->where(function (Builder $query) use ($connection): void {
                $query->whereNull('phone_number_id')->orWhere('phone_number_id', $connection?->phone_number_id ?? '');
            })
            ->latest('id')
            ->paginate(min(50, max(1, $request->integer('per_page', 20))));

        $events->through(fn (WhatsAppWebhookEvent $event): array => $this->summary($event));

        return $this->ok($events);
    }

    private function canonicalValue(mixed $value): mixed
    {
        if ($value instanceof stdClass) {
            $properties = get_object_vars($value);
            ksort($properties, SORT_STRING);

            return (object) array_map(fn (mixed $item): mixed => $this->canonicalValue($item), $properties);
        }

        return is_array($value) ? array_map(fn (mixed $item): mixed => $this->canonicalValue($item), $value) : $value;
    }

    /** @param array<string, mixed> $value */
    private function updateConnection(WhatsAppConnection $connection, string $field, array $value, mixed $timestamp): void
    {
        if ($field === 'history') {
            $declined = false;
            $progress = (int) $connection->sync_progress;
            foreach ((array) ($value['history'] ?? []) as $history) {
                $chunkProgress = data_get($history, 'metadata.progress');
                if (is_numeric($chunkProgress)) {
                    $progress = max($progress, min(100, max(0, (int) $chunkProgress)));
                }
                foreach ((array) data_get($history, 'errors', []) as $error) {
                    $declined = $declined || (string) data_get($error, 'code') === '2593109';
                }
            }

            $connection->sync_progress = $progress;
            if ($declined || $connection->history_status === 'declined') {
                $connection->history_status = 'declined';
            } elseif ($progress === 100) {
                $connection->history_status = 'complete';
            } elseif ($connection->history_status !== 'complete') {
                $connection->history_status = 'syncing';
            }
        }

        if ($field === 'account_update' && in_array($value['event'] ?? null, ['PARTNER_REMOVED', 'ACCOUNT_OFFBOARDED'], true)) {
            if (! (is_int($timestamp) || (is_string($timestamp) && ctype_digit($timestamp))) || (int) $timestamp <= 0) {
                return;
            }

            $eventAt = Carbon::createFromTimestamp((int) $timestamp, config('app.timezone'));
            if (($connection->lifecycle_event_at && $eventAt->getTimestamp() < $connection->lifecycle_event_at->getTimestamp())
                || ($connection->connected_at && $eventAt->getTimestamp() < $connection->connected_at->getTimestamp())) {
                return;
            }

            $connection->status = 'disconnected';
            $connection->disconnected_at = $eventAt;
            $connection->lifecycle_event_at = $eventAt;
        }
    }

    private function summary(WhatsAppWebhookEvent $event): array
    {
        $value = $event->payload;
        $messages = [];
        $messageCount = 0;
        $append = function (mixed $message, string $direction, mixed $peer) use (&$messages, &$messageCount): void {
            if (! is_array($message)) {
                return;
            }
            $messageCount++;
            if (count($messages) >= 50) {
                return;
            }
            $body = data_get($message, 'text.body');
            $messages[] = [
                'direction' => $direction,
                'peer_number' => is_scalar($peer) ? (string) $peer : null,
                'body' => is_string($body) ? $body : null,
                'type' => is_string($message['type'] ?? null) ? $message['type'] : null,
            ];
        };

        if ($event->field === 'smb_message_echoes') {
            foreach ((array) ($value['message_echoes'] ?? []) as $message) {
                $append($message, 'outgoing', data_get($message, 'to'));
            }
        } elseif ($event->field === 'messages') {
            foreach ((array) ($value['messages'] ?? []) as $message) {
                $append($message, 'incoming', data_get($message, 'from'));
            }
        } elseif ($event->field === 'history') {
            foreach ((array) ($value['history'] ?? []) as $history) {
                foreach ((array) data_get($history, 'threads', []) as $thread) {
                    $peer = data_get($thread, 'id');
                    foreach ((array) data_get($thread, 'messages', []) as $message) {
                        $direction = (string) data_get($message, 'from') === (string) $peer ? 'incoming' : 'outgoing';
                        $append($message, $direction, $peer);
                    }
                }
            }
        }

        return [
            'id' => $event->id,
            'field' => $event->field,
            'received_at' => $event->received_at?->toIso8601String(),
            'message_count' => $messageCount,
            'contact_count' => $event->field === 'smb_app_state_sync' ? count((array) ($value['state_sync'] ?? [])) : 0,
            'status_count' => $event->field === 'messages' ? count((array) ($value['statuses'] ?? [])) : 0,
            'messages' => $messages,
        ];
    }
}
