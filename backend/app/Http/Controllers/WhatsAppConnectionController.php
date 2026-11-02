<?php

namespace App\Http\Controllers;

use App\Models\WhatsAppConnection;
use App\Support\ApiHelpers;
use App\Support\ApplicationRealtime;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

class WhatsAppConnectionController extends Controller
{
    use ApiHelpers;

    public function start(Request $request): JsonResponse
    {
        $this->requireRole($request, 'admin');
        abort_unless($this->ready(), 422, 'Meta Coexistence onboarding is not configured. Ask the server administrator to complete the Meta app and HTTPS webhook setup.');
        $data = $request->validate([
            'phone' => ['required', 'string', 'regex:/^\+[1-9][0-9]{7,14}$/'],
            'sync_consent' => ['required', 'accepted'],
        ]);
        $state = Str::random(64);
        Cache::put('whatsapp:onboarding:'.hash('sha256', $state), [
            'user_id' => $request->user()->id,
            'phone' => $data['phone'],
        ], now()->addMinutes(10));

        return $this->ok([
            'state' => $state,
            'app_id' => (string) config('whatsapp.app_id'),
            'config_id' => (string) config('whatsapp.signup_config_id'),
            'graph_version' => config('whatsapp.graph_version'),
        ]);
    }

    public function complete(Request $request): JsonResponse
    {
        $this->requireRole($request, 'admin');
        abort_unless($this->ready(), 422, 'Meta Coexistence onboarding is not configured.');
        $data = $request->validate([
            'state' => ['required', 'string', 'size:64'],
            'code' => ['required', 'string', 'max:4096'],
            'waba_id' => ['required', 'string', 'regex:/^[0-9]+$/', 'max:64'],
        ]);
        $key = 'whatsapp:onboarding:'.hash('sha256', $data['state']);
        $session = Cache::get($key);
        abort_unless($session && $session['user_id'] === $request->user()->id, 422, 'Connection attempt expired or belongs to another administrator. Start again.');
        $lock = Cache::lock('whatsapp:connection', 180);
        abort_unless($lock->get(), 409, 'Another connection attempt is running. Try again shortly.');

        try {
            $verificationStartedAt = now()->startOfSecond();
            // Consume once before exchanging the short-lived code. Never replay Graph mutations.
            abort_unless(Cache::pull($key), 422, 'Connection attempt has already been used. Start again.');
            $exchange = $this->graph()->get('oauth/access_token', [
                'client_id' => config('whatsapp.app_id'),
                'client_secret' => config('whatsapp.app_secret'),
                'code' => $data['code'],
            ]);
            abort_unless($exchange->successful() && is_string($exchange->json('access_token')), 422, 'Meta could not authorize the connection. Restart Meta signup.');
            $token = $exchange->json('access_token');
            $debug = $this->graph((string) config('whatsapp.app_id').'|'.config('whatsapp.app_secret'))
                ->get('debug_token', ['input_token' => $token]);
            $scopes = $debug->json('data.scopes', []);
            abort_unless($debug->successful() && $debug->json('data.is_valid') === true
                && (string) $debug->json('data.app_id') === (string) config('whatsapp.app_id')
                && is_array($scopes) && in_array('whatsapp_business_management', $scopes, true)
                && in_array('whatsapp_business_messaging', $scopes, true), 422, 'Meta did not grant this app the required WhatsApp permissions.');

            $numbers = $this->graph($token)->get($data['waba_id'].'/phone_numbers', [
                'fields' => 'id,display_phone_number,is_on_biz_app,platform_type', 'limit' => 100,
            ]);
            abort_unless($numbers->successful(), 422, 'Meta did not grant access to the selected WhatsApp account.');
            $phone = collect($numbers->json('data', []))->first(fn (array $number) => preg_replace('/\D/', '', (string) ($number['display_phone_number'] ?? '')) === ltrim($session['phone'], '+'));
            abort_unless($phone && ($phone['is_on_biz_app'] ?? false) === true
                && ($phone['platform_type'] ?? '') === 'CLOUD_API', 422, 'The selected number is not active in both WhatsApp Business app and Cloud API. Choose your existing Business app number in Meta.');
            // Coexistence numbers are already registered. Never call /register or /deregister.
            // Publish a non-sendable identity before subscribing, so immediate webhooks are retained.
            $connection = DB::transaction(function () use ($request, $data, $phone, $token, $verificationStartedAt): WhatsAppConnection {
                $existing = WhatsAppConnection::query()->lockForUpdate()->find(1);
                abort_if($existing && $existing->status === 'connected'
                    && $existing->phone_number_id !== $phone['id'], 409, 'A different clinic number is already connected. Disconnect it in the Business app before replacing it.');
                abort_if($existing?->status === 'disconnected' && $existing->lifecycle_event_at
                    && $existing->lifecycle_event_at->getTimestamp() >= $verificationStartedAt->getTimestamp(), 409, 'Meta disconnected this account during verification. Restart signup after resolving the disconnect.');
                $resetSync = ! $existing || $existing->status === 'disconnected'
                    || $existing->phone_number_id !== $phone['id'];

                return WhatsAppConnection::updateOrCreate(['id' => 1], [
                    'waba_id' => $data['waba_id'], 'phone_number_id' => $phone['id'],
                    'display_phone_number' => $phone['display_phone_number'], 'token' => $token,
                    'status' => 'connecting', 'connected_by' => $request->user()->id,
                    'connected_at' => $verificationStartedAt, 'disconnected_at' => null, 'lifecycle_event_at' => $verificationStartedAt,
                ] + ($resetSync ? [
                    'contacts_sync_request_id' => null, 'history_sync_request_id' => null,
                    'history_status' => 'pending', 'sync_progress' => 0, 'last_webhook_at' => null,
                ] : []));
            });
            $subscription = $this->graph($token)->post($data['waba_id'].'/subscribed_apps');
            if (! $subscription->successful() || $subscription->json('success') !== true) {
                if (WhatsAppConnection::whereKey(1)->where('status', 'connecting')->update(['status' => 'connection_failed'])) {
                    app(ApplicationRealtime::class)->changed($connection);
                }
                abort(502, 'Meta could not subscribe this app to WhatsApp webhooks. Sending remains unavailable; restart signup.');
            }
            DB::transaction(function (): void {
                $current = WhatsAppConnection::query()->lockForUpdate()->findOrFail(1);
                abort_unless($current->status === 'connecting', 409, 'Meta disconnected this account while connecting. Restart signup after resolving the disconnect.');
                $current->update(['status' => 'connected']);
            });
            $connection->refresh();
            // A same-number reconnect keeps previous one-shot sync request receipts.
            $syncIssues = false;
            foreach (['smb_app_state_sync' => 'contacts_sync_request_id', 'history' => 'history_sync_request_id'] as $type => $column) {
                if ($connection->{$column} === 'pending_confirmation') {
                    $syncIssues = true;

                    continue;
                }
                if ($connection->{$column} && $connection->{$column} !== 'rejected') {
                    continue;
                }
                abort_unless($connection->fresh()->status === 'connected', 409, 'Meta disconnected this account during synchronization.');
                // Persist before the call: a timeout must not repeat a one-shot import.
                $connection->update([$column => 'pending_confirmation']);
                try {
                    $sync = $this->graph($token)->post($phone['id'].'/smb_app_data', [
                        'messaging_product' => 'whatsapp', 'sync_type' => $type,
                    ]);
                } catch (ConnectionException) {
                    $syncIssues = true;

                    continue;
                }
                if (! $sync->successful() || ! is_string($sync->json('request_id'))) {
                    if ($sync->clientError()) {
                        $connection->update([$column => 'rejected']);
                    }
                    $syncIssues = true;

                    continue;
                }
                $connection->update([$column => $sync->json('request_id')]);
            }
            $this->audit($request, 'whatsapp.coexistence.connected', 'WhatsAppConnection', 1, 'Connected existing WhatsApp Business app number with synchronization consent.');
            if ($syncIssues) {
                if (WhatsAppConnection::whereKey(1)->whereNotIn('history_status', ['complete', 'declined'])->update(['history_status' => 'needs_attention'])) {
                    app(ApplicationRealtime::class)->changed($connection);
                }
                abort(502, 'Number connected with a synchronization issue. Rejected imports can be retried by reconnecting. Unconfirmed imports require Meta support and will not be repeated.');
            }

            return $this->ok($connection->fresh());
        } catch (ConnectionException) {
            if (isset($connection)) {
                if (WhatsAppConnection::whereKey(1)->where('status', 'connecting')->update(['status' => 'connection_failed'])) {
                    app(ApplicationRealtime::class)->changed($connection);
                }
            }
            abort(502, 'Meta did not respond. Check connection status before starting again; a synchronization request may already have been accepted.');
        } finally {
            $lock->release();
        }
    }

    private function ready(): bool
    {
        return (bool) config('whatsapp.coexistence_ready') && config('whatsapp.app_id')
            && config('whatsapp.app_secret') && config('whatsapp.signup_config_id')
            && config('whatsapp.webhook_verify_token');
    }

    private function graph(?string $token = null): PendingRequest
    {
        $request = Http::baseUrl('https://graph.facebook.com/'.config('whatsapp.graph_version').'/')
            ->acceptJson()->asJson()->connectTimeout(5)->timeout(20)->withoutRedirecting();

        return $token ? $request->withToken($token) : $request;
    }
}
