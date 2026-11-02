<?php

namespace App\Support;

use App\Models\WhatsAppMetaTemplate;
use App\Models\WhatsAppTemplate;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use JsonException;
use RuntimeException;
use stdClass;

/**
 * Explicit two-way synchronization between clinic event templates and the
 * connected Meta WhatsApp account.
 *
 * Pull imports Meta content and approval status. Publish sends a clinic draft
 * to Meta for review. Neither direction overwrites the other silently: a local
 * edit and a remote change produce a conflict that an administrator resolves.
 * Meta approval is never inferred from a successful submit.
 */
class WhatsAppTemplateSync
{
    public const VARIABLES = [
        'patient_name', 'clinic_name', 'doctor_name', 'appointment_date',
        'appointment_time', 'reason', 'portal_link', 'invoice_number', 'amount', 'message',
    ];

    private const EDITABLE_STATUSES = ['APPROVED', 'REJECTED', 'PAUSED'];

    /** @return array{waba_id:string,token:string}|null */
    public function credentials(): ?array
    {
        return WhatsAppSender::account();
    }

    public function catalogForCurrentAccount(): Collection
    {
        $credentials = $this->credentials();

        return WhatsAppMetaTemplate::query()
            ->where('waba_id', $credentials['waba_id'] ?? '__none__')
            ->orderBy('name')
            ->orderBy('language')
            ->get();
    }

    public function lastPulledAt(): ?string
    {
        return $this->catalogForCurrentAccount()->max('last_synced_at')?->toIso8601String();
    }

    /**
     * Fetch the full Meta catalog first, then apply it in one transaction.
     * A failed page aborts before anything is marked missing.
     *
     * @return array{imported:int,updated:int,conflicts:int}
     */
    public function pull(): array
    {
        $credentials = $this->credentials();
        abort_unless($credentials, 422, 'Connect a WhatsApp account before syncing Meta templates.');
        abort_if($credentials['waba_id'] === '', 422, 'Set WHATSAPP_BUSINESS_ACCOUNT_ID so the template catalog of the standard number can be read.');

        $rows = $this->fetchCatalog($credentials);
        $now = now();
        $imported = 0;
        $updated = 0;
        $conflicts = 0;

        DB::transaction(function () use ($rows, $credentials, $now, &$imported, &$updated, &$conflicts): void {
            WhatsAppMetaTemplate::query()
                ->where('waba_id', $credentials['waba_id'])
                ->each(fn (WhatsAppMetaTemplate $template) => $template->update(['missing' => true]));

            foreach ($rows as $row) {
                if (! is_array($row) || ! isset($row['id'], $row['name'], $row['language'])) {
                    continue;
                }

                $parsed = $this->parse($row);
                WhatsAppMetaTemplate::query()->updateOrCreate(
                    ['waba_id' => $credentials['waba_id'], 'meta_template_id' => (string) $row['id']],
                    $parsed + ['missing' => false, 'last_synced_at' => $now],
                );

                $local = WhatsAppTemplate::query()
                    ->where('meta_template_id', (string) $row['id'])
                    ->first();

                // A create whose response was lost can be matched by the exact content we submitted.
                if (! $local) {
                    $local = WhatsAppTemplate::query()
                        ->whereNull('meta_template_id')
                        ->where('sync_state', 'uncertain')
                        ->where('pending_action', 'create')
                        ->where('template_name', $parsed['name'])
                        ->where('language', $parsed['language'])
                        ->where('pending_hash', $parsed['remote_hash'])
                        ->first();

                    if ($local) {
                        $local->forceFill(['meta_template_id' => $parsed['meta_template_id']])->save();
                    }
                }

                if (! $local) {
                    $imported++;

                    continue;
                }

                // A publish that timed out is only resolved when Meta shows the content we sent.
                if (in_array($local->sync_state, ['pending', 'uncertain'], true)
                    && $local->pending_hash
                    && $parsed['remote_hash'] === $local->pending_hash) {
                    $local->forceFill([
                        'template_name' => $parsed['name'],
                        'language' => $parsed['language'],
                        'category' => $parsed['category'],
                        'baseline_hash' => $parsed['remote_hash'],
                        'baseline_local_hash' => $this->localHash($parsed['name'], $local->body),
                        'sync_state' => $parsed['status'] === 'APPROVED' ? 'synced' : 'pending',
                        'pending_hash' => null,
                        'pending_action' => null,
                        'sync_error' => null,
                        'last_synced_at' => $now,
                        'revision' => $local->revision + 1,
                    ])->save();
                    $updated++;

                    continue;
                }

                if ($parsed['remote_hash'] === $local->baseline_hash) {
                    continue;
                }

                $localEdited = $local->baseline_local_hash !== null
                    && $this->localHash($local->template_name, $local->body) !== $local->baseline_local_hash;

                if ($localEdited || $local->baseline_hash === null) {
                    if ($local->sync_state !== 'conflict') {
                        $conflicts++;
                    }
                    $local->forceFill([
                        'sync_state' => 'conflict',
                        'sync_error' => 'Meta changed this template while the clinic draft also changed. Choose which wording to keep.',
                    ])->save();

                    continue;
                }

                $bindings = $this->bindingList($local->bindings);
                $body = $this->toLocalBody((string) $parsed['body'], $parsed['placeholders'], $bindings);

                if ($body === null) {
                    $local->forceFill([
                        'sync_state' => 'conflict',
                        'sync_error' => 'Meta added or removed message parameters. Re-map this template before sending.',
                    ])->save();
                    $conflicts++;

                    continue;
                }

                $local->forceFill([
                    'template_name' => $parsed['name'],
                    'body' => $body,
                    'language' => $parsed['language'],
                    'category' => $parsed['category'],
                    'baseline_hash' => $parsed['remote_hash'],
                    'baseline_local_hash' => $this->localHash($parsed['name'], $body),
                    'sync_state' => $parsed['status'] === 'APPROVED' ? 'synced' : 'pending',
                    'revision' => $local->revision + 1,
                    'last_synced_at' => $now,
                    'sync_error' => null,
                ])->save();
                $updated++;
            }
        });

        return ['imported' => $imported, 'updated' => $updated, 'conflicts' => $conflicts];
    }

    /**
     * Replace one clinic event's wording with a Meta template's content.
     *
     * @param  array<string, string>  $bindings  Meta parameter key => clinic variable name.
     */
    public function adopt(string $event, int $metaId, array $bindings, int $expectedRevision): WhatsAppTemplate
    {
        $credentials = $this->credentials();
        abort_unless($credentials, 422, 'Connect a WhatsApp account before importing a template.');

        return Cache::lock('whatsapp:templates', 120)->block(5, function () use ($credentials, $event, $metaId, $bindings, $expectedRevision): WhatsAppTemplate {
            $catalog = WhatsAppMetaTemplate::query()
                ->where('waba_id', $credentials['waba_id'])
                ->whereKey($metaId)
                ->first();
            abort_unless($catalog && ! $catalog->missing, 422, 'That Meta template is not in the current catalog. Pull from Meta first.');
            abort_unless($catalog->supported, 422, $catalog->unsupported_reason ?? 'This Meta template shape is not supported here.');

            $keys = array_map(static fn (mixed $key): string => (string) $key, (array) $catalog->placeholders);
            $ordered = $this->validateBindings($keys, $bindings);
            $body = $this->toLocalBody((string) $catalog->body, $keys, $ordered);

            if ($body === null) {
                abort(422, 'The selected Meta template is missing a readable message body.');
            }

            return DB::transaction(function () use ($event, $catalog, $ordered, $body, $expectedRevision): WhatsAppTemplate {
                $local = WhatsAppTemplate::query()->where('event', $event)->lockForUpdate()->first();
                abort_unless($local, 404, 'Unknown template event.');
                abort_unless($local->revision === $expectedRevision, 409, 'This template changed elsewhere. Reload before importing.');

                $local->forceFill([
                    'template_name' => $catalog->name,
                    'body' => $body,
                    'meta_template_id' => $catalog->meta_template_id,
                    'language' => $catalog->language,
                    'category' => $catalog->category,
                    'bindings' => $ordered,
                    'baseline_hash' => $catalog->remote_hash,
                    'baseline_local_hash' => $this->localHash($catalog->name, $body),
                    'sync_state' => $catalog->status === 'APPROVED' ? 'synced' : 'pending',
                    'pending_hash' => null,
                    'pending_action' => null,
                    'sync_error' => null,
                    'last_synced_at' => now(),
                    'revision' => $local->revision + 1,
                ])->save();

                return $local;
            });
        });
    }

    /**
     * Submit the current clinic draft to Meta. Creating a new template and
     * editing an existing one are different operations with different rules.
     *
     * @return array{template:array<string,mixed>,confirmed:bool,message:string}
     */
    public function publish(string $event, int $expectedRevision, bool $keepClinicWording = false, ?array $header = null): array
    {
        $credentials = $this->credentials();
        abort_unless($credentials, 422, 'Connect a WhatsApp account before publishing a template.');

        return Cache::lock('whatsapp:templates', 120)->block(5, function () use ($credentials, $event, $expectedRevision, $keepClinicWording, $header): array {
            $local = WhatsAppTemplate::query()->where('event', $event)->first();
            abort_unless($local, 404, 'Unknown template event.');
            abort_unless($local->revision === $expectedRevision, 409, 'This template changed elsewhere. Reload before publishing.');
            abort_if($local->sync_state === 'uncertain', 409, 'A previous publish result is unconfirmed. Pull from Meta before publishing again.');
            abort_if($local->sync_state === 'conflict' && ! $keepClinicWording, 409, 'Resolve the Meta conflict before publishing.');

            $catalog = null;
            if ($local->meta_template_id) {
                $catalog = WhatsAppMetaTemplate::query()
                    ->where('waba_id', $credentials['waba_id'])
                    ->where('meta_template_id', $local->meta_template_id)
                    ->first();
                abort_unless($catalog && ! $catalog->missing, 422, 'The linked Meta template is missing. Pull from Meta and link it again.');
                abort_unless($catalog->supported, 422, $catalog->unsupported_reason ?? 'This Meta template shape cannot be edited here.');
                abort_unless(in_array($catalog->status, self::EDITABLE_STATUSES, true), 422, 'Meta only allows edits while a template is approved, rejected or paused.');
                abort_unless($local->template_name === $catalog->name, 409, 'Meta does not allow renaming a template. Publish under a new name to create a new template.');

                if ($local->sync_state === 'conflict' && $keepClinicWording) {
                    // The administrator explicitly chose the clinic wording over Meta's new wording.
                    $local->forceFill([
                        'baseline_hash' => $catalog->remote_hash,
                        'sync_state' => 'draft',
                        'sync_error' => null,
                    ])->save();
                }
            }

            $bindings = $this->bindingList($local->bindings);
            if ($bindings === []) {
                if ($catalog && (array) $catalog->placeholders !== []) {
                    abort(422, 'Map this template to its Meta parameters before publishing.');
                }
                // A new template defines its own positional parameters in body order.
                $bindings = $this->deriveBindings($local->body);
            }

            foreach ($bindings as $binding) {
                abort_unless(in_array($binding['variable'], self::VARIABLES, true), 422, 'Every Meta parameter needs a known clinic variable.');
            }

            $remoteBody = $this->toRemoteBody($local->body, $bindings);
            abort_unless($remoteBody !== null, 422, 'The message wording no longer matches its Meta parameters. Re-map the template before publishing.');
            abort_unless(preg_match('/^[a-z0-9_]{1,512}$/', $local->template_name) === 1, 422, 'Template names use lowercase letters, numbers and underscores only.');

            $components = $this->outboundComponents($catalog, $remoteBody, $header);
            $desiredHash = $this->remoteHash($local->template_name, (string) ($local->language ?: config('whatsapp.language', 'en')), (string) ($local->category ?: 'UTILITY'), $catalog?->parameter_format ?? 'POSITIONAL', $components);

            if ($catalog) {
                $current = $this->fetchTemplate($credentials, $catalog->meta_template_id);
                abort_unless($current !== null, 502, 'Meta did not confirm the current template. Pull from Meta and try again.');
                abort_unless($current['remote_hash'] === $local->baseline_hash, 409, 'This Meta template changed outside the clinic system. Pull from Meta and resolve it before publishing.');
                $components = $this->outboundComponents($current, $remoteBody);
                $desiredHash = $this->remoteHash($catalog->name, $catalog->language, (string) ($catalog->category ?: 'UTILITY'), $current['parameter_format'], $components);
            }

            if (! $catalog) {
                // Persist the identity used for the create so a lost response can be reconciled by pull.
                $local->forceFill([
                    'language' => $local->language ?: (string) config('whatsapp.language', 'en'),
                    'category' => $local->category ?: 'UTILITY',
                ]);
            }

            $this->markPublishAttempt($local, $desiredHash, $catalog ? 'edit' : 'create', $bindings);

            try {
                if ($catalog) {
                    $response = $this->graph($credentials['token'])->post($this->endpoint($catalog->meta_template_id), ['components' => $components]);
                } else {
                    $response = $this->graph($credentials['token'])->post($this->endpoint($credentials['waba_id'].'/message_templates'), [
                        'name' => $local->template_name,
                        'language' => (string) ($local->language ?: config('whatsapp.language', 'en')),
                        'category' => (string) ($local->category ?: 'UTILITY'),
                        'components' => $components,
                    ]);
                }
            } catch (ConnectionException) {
                $this->markUncertain($local, 'Meta did not respond. The submit may have been accepted; pull from Meta to confirm.');

                abort(502, 'Meta did not respond. Pull from Meta before publishing again.');
            }

            if (! $response->successful()) {
                $message = $this->safeError($response->json('error.message'), 'Meta rejected the template.');
                if ($response->clientError()) {
                    $local->forceFill(['sync_state' => 'draft', 'pending_hash' => null, 'pending_action' => null, 'sync_error' => $message])->save();
                    abort(422, $message);
                }

                $this->markUncertain($local, $message);
                abort(502, $message);
            }

            $metaId = $catalog?->meta_template_id ?: $response->json('id');
            if (! is_string($metaId) && ! is_int($metaId)) {
                $this->markUncertain($local, 'Meta accepted the request but did not return a template ID.');

                return ['template' => $this->describe($local->fresh()), 'confirmed' => false, 'message' => 'Submitted. Pull from Meta to confirm the new template.'];
            }

            $confirmed = $this->fetchTemplate($credentials, (string) $metaId);
            if (! $confirmed) {
                $this->markUncertain($local, 'Meta accepted the template but confirmation is pending.');
                $local->forceFill(['meta_template_id' => (string) $metaId])->save();

                return ['template' => $this->describe($local->fresh()), 'confirmed' => false, 'message' => 'Submitted. Pull from Meta to confirm approval status.'];
            }

            $this->storeConfirmed($local, $credentials['waba_id'], $confirmed);

            return [
                'template' => $this->describe($local->fresh()),
                'confirmed' => true,
                'message' => $confirmed['status'] === 'APPROVED' ? 'Meta approved the template.' : 'Submitted to Meta. Approval is still pending.',
            ];
        });
    }

    /**
     * Resolve the exact remote body and ordered parameter values for a live send.
     *
     * @param  array<string, string>  $values
     * @return array{name:string,language:string,parameters:list<string>}
     */
    public function outbound(WhatsAppTemplate $local, array $values): array
    {
        $credentials = $this->credentials();
        if (! $credentials) {
            throw new RuntimeException('WhatsApp is not connected.');
        }

        if ($credentials['waba_id'] === '') {
            throw new RuntimeException('Set WHATSAPP_BUSINESS_ACCOUNT_ID before sending with the standard number.');
        }

        if (! $local->is_active) {
            throw new RuntimeException('This message type is turned off.');
        }

        if (! $local->meta_template_id) {
            throw new RuntimeException('The clinic wording is not confirmed against an approved Meta template.');
        }

        $catalog = WhatsAppMetaTemplate::query()
            ->where('waba_id', $credentials['waba_id'])
            ->where('meta_template_id', $local->meta_template_id)
            ->first();

        if (! $catalog || $catalog->missing) {
            throw new RuntimeException('The linked Meta template is missing from the business account.');
        }

        if ($catalog->status !== 'APPROVED') {
            throw new RuntimeException('The Meta template is not approved.');
        }

        if ($local->sync_state !== 'synced') {
            throw new RuntimeException('The clinic wording is not confirmed against an approved Meta template.');
        }

        if (! $catalog->supported) {
            throw new RuntimeException($catalog->unsupported_reason ?? 'This Meta template shape is not supported here.');
        }

        if ((int) $catalog->button_parameter_count > 0) {
            throw new RuntimeException('This template has a button that needs a value, so it cannot be sent automatically. Send it from WhatsApp instead.');
        }

        if ((int) $catalog->header_parameter_count > 0) {
            throw new RuntimeException('This template has a header that needs a value, so it cannot be sent automatically. Send it from WhatsApp instead.');
        }

        $bindings = $this->bindingList($local->bindings);
        $remoteBody = $this->toRemoteBody($local->body, $bindings);
        if ($remoteBody === null || $remoteBody !== $catalog->body) {
            throw new RuntimeException('The clinic wording no longer matches the approved Meta template. Pull from Meta or re-map the template.');
        }

        $header = null;
        $mediaType = strtoupper((string) $catalog->header_type);
        if (in_array($mediaType, ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'], true)) {
            if (! $local->media_url) {
                throw new RuntimeException('This template sends a photo, video, audio or document. Add a public media link for this message type before sending.');
            }
            $header = [
                'type' => strtolower($mediaType),
                'link' => (string) $local->media_url,
            ];
        }

        return [
            'name' => $catalog->name,
            'language' => (string) ($local->language ?: $catalog->language),
            'parameters' => array_map(
                static fn (array $binding): string => (string) ($values[$binding['variable']] ?? ''),
                $bindings,
            ),
            'header' => $header,
        ];
    }

    /**
     * Mark a locally edited draft without losing a conflict that still needs a decision.
     */
    public function noteLocalEdit(WhatsAppTemplate $local): void
    {
        if ($local->baseline_local_hash === null) {
            return;
        }

        if ($this->localHash($local->template_name, $local->body) === $local->baseline_local_hash) {
            if ($local->sync_state === 'draft') {
                $local->sync_state = $local->baseline_hash ? 'synced' : 'local';
            }

            return;
        }

        if ($local->sync_state !== 'conflict') {
            $local->sync_state = 'draft';
        }
    }

    /** @return array<string,mixed> */
    public function describe(WhatsAppTemplate $local): array
    {
        $catalog = $local->meta_template_id
            ? WhatsAppMetaTemplate::query()->where('meta_template_id', $local->meta_template_id)->latest('last_synced_at')->first()
            : null;

        return [
            'event' => $local->event,
            'template_name' => $local->template_name,
            'body' => $local->body,
            'is_active' => (bool) $local->is_active,
            'revision' => (int) $local->revision,
            'sync_state' => (string) $local->sync_state,
            'meta_template_id' => $local->meta_template_id,
            'meta_status' => $catalog?->status,
            'meta_missing' => (bool) $catalog?->missing,
            'language' => (string) ($local->language ?: config('whatsapp.language', 'en')),
            'last_synced_at' => $local->last_synced_at?->toIso8601String(),
            'bindings' => $this->bindingList($local->bindings),
            'placeholders' => $this->localPlaceholders($local->body),
            'media_url' => $local->media_url,
            'header_type' => $catalog?->header_type,
            'buttons' => $catalog?->button_summary ?? [],
            'sync_error' => $local->sync_error,
        ];
    }

    /** @param list<array{key:string,variable:string}> $bindings */
    public function toRemoteBody(string $localBody, array $bindings): ?string
    {
        $queue = $bindings;
        $failed = false;

        $result = preg_replace_callback('/\{\{\s*([a-z0-9_]+)\s*\}\}/i', function (array $matches) use (&$queue, &$failed): string {
            $index = null;
            foreach ($queue as $position => $binding) {
                if ($binding['variable'] === $matches[1]) {
                    $index = $position;
                    break;
                }
            }
            if ($index === null) {
                $failed = true;

                return $matches[0];
            }
            $key = $queue[$index]['key'];
            unset($queue[$index]);
            $queue = array_values($queue);

            return '{{'.$key.'}}';
        }, $localBody) ?? '';

        return $failed || $queue !== [] ? null : $result;
    }

    /** @param list<array{key:string,variable:string}> $bindings */
    public function toLocalBody(string $remoteBody, array $keys, array $bindings): ?string
    {
        if (count($keys) !== count($bindings)) {
            return null;
        }

        $map = [];
        foreach ($bindings as $binding) {
            $map[$binding['key']] = $binding['variable'];
        }

        foreach ($keys as $key) {
            if (! isset($map[$key])) {
                return null;
            }
        }

        $body = $remoteBody;
        foreach ($map as $key => $variable) {
            $body = preg_replace('/\{\{\s*'.preg_quote((string) $key, '/').'\s*\}\}/', '{{'.$variable.'}}', $body) ?? $body;
        }

        return $body;
    }

    /** @return list<string> */
    public function localPlaceholders(string $body): array
    {
        preg_match_all('/\{\{\s*([a-z0-9_]+)\s*\}\}/i', $body, $matches);

        return array_values(array_unique(array_map('strtolower', $matches[1])));
    }

    /**
     * Positional parameters for a brand-new template, one per placeholder occurrence.
     *
     * @return list<array{key:string,variable:string}>
     */
    private function deriveBindings(string $body): array
    {
        preg_match_all('/\{\{\s*([a-z0-9_]+)\s*\}\}/i', $body, $matches);

        $bindings = [];
        foreach ($matches[1] as $index => $variable) {
            $bindings[] = ['key' => (string) ($index + 1), 'variable' => strtolower($variable)];
        }

        return $bindings;
    }

    /**
     * @param  list<string>  $keys
     * @param  array<string, string>  $bindings
     * @return list<array{key:string,variable:string}>
     */
    private function validateBindings(array $keys, array $bindings): array
    {
        if ($keys === []) {
            abort_unless($bindings === [], 422, 'This Meta template has no message parameters.');
        }

        abort_unless(count($bindings) === count($keys), 422, 'Map every Meta parameter to a clinic variable.');

        $ordered = [];
        foreach ($keys as $key) {
            $variable = $bindings[$key] ?? null;
            abort_unless(is_string($variable) && in_array($variable, self::VARIABLES, true), 422, 'Every Meta parameter needs a clinic variable.');
            $ordered[] = ['key' => $key, 'variable' => $variable];
        }

        return $ordered;
    }

    /**
     * @return list<array{key:string,variable:string}>
     */
    private function bindingList(mixed $bindings): array
    {
        if (! is_array($bindings)) {
            return [];
        }

        $list = [];
        foreach ($bindings as $binding) {
            if (is_array($binding) && isset($binding['key'], $binding['variable'])
                && is_string($binding['key']) && is_string($binding['variable'])) {
                $list[] = ['key' => $binding['key'], 'variable' => $binding['variable']];
            }
        }

        return $list;
    }

    /**
     * @param  array{waba_id:string,token:string}  $credentials
     * @return list<array<string,mixed>>
     */
    private function fetchCatalog(array $credentials): array
    {
        $url = rtrim((string) config('whatsapp.api_base'), '/').'/'.config('whatsapp.graph_version')
            .'/'.$credentials['waba_id'].'/message_templates';
        $query = [
            'fields' => 'id,name,language,category,status,parameter_format,components',
            'limit' => 100,
        ];
        $rows = [];
        $pages = 0;

        while ($url !== null) {
            $pages++;
            abort_if($pages > 100, 502, 'The Meta template catalog is too large to sync safely.');
            // Follow the next link verbatim: passing a query array here would drop its cursor.
            $response = $query === null
                ? $this->graph($credentials['token'])->get($url)
                : $this->graph($credentials['token'])->get($url, $query);
            abort_unless($response->successful(), 502, 'Meta did not return the template catalog.');
            $data = $response->json('data');
            abort_unless(is_array($data), 502, 'Meta returned an unexpected template catalog.');

            foreach ($data as $row) {
                if (is_array($row)) {
                    $rows[] = $row;
                }
            }

            $next = $response->json('paging.next');
            $url = is_string($next) ? $this->safeNextUrl($next, $credentials['waba_id']) : null;
            $query = null;
        }

        return $rows;
    }

    private function safeNextUrl(string $next, string $wabaId): string
    {
        $parts = parse_url($next);
        $base = parse_url((string) config('whatsapp.api_base'));
        abort_unless(is_array($parts) && ($parts['scheme'] ?? null) === 'https'
            && ($parts['host'] ?? null) === ($base['host'] ?? null)
            && str_contains((string) ($parts['path'] ?? ''), '/'.$wabaId.'/message_templates'),
            502, 'Meta returned an unsafe pagination link.');

        return $next;
    }

    /** @return array<string,mixed>|null */
    private function fetchTemplate(array $credentials, string $metaId): ?array
    {
        try {
            $response = $this->graph($credentials['token'])->get($this->endpoint($metaId), [
                'fields' => 'id,name,language,category,status,parameter_format,components',
            ]);
        } catch (ConnectionException) {
            return null;
        }

        $data = $response->json();

        return $response->successful() && is_array($data) && isset($data['id']) ? $this->parse($data) : null;
    }

    /**
     * @param  array<string,mixed>  $row
     * @return array<string,mixed>
     */
    private function parse(array $row): array
    {
        $components = array_values(array_filter((array) ($row['components'] ?? []), 'is_array'));
        $body = null;
        $footer = null;
        $unsupported = null;
        $format = isset($row['parameter_format']) ? (string) $row['parameter_format'] : 'POSITIONAL';
        $headerType = null;
        $headerExample = null;
        $headerParameters = 0;
        $buttonSummary = [];
        $buttonParameters = 0;

        foreach ($components as $component) {
            $type = strtoupper((string) ($component['type'] ?? ''));
            if ($type === 'BODY' && $body === null) {
                $body = is_string($component['text'] ?? null) ? $component['text'] : null;
            }
            if ($type === 'FOOTER' && $footer === null) {
                $footer = is_string($component['text'] ?? null) ? $component['text'] : null;
            }
            if ($type === 'HEADER') {
                $headerType = strtoupper((string) ($component['format'] ?? 'TEXT'));
                $headerText = is_string($component['text'] ?? null) ? $component['text'] : '';
                $headerParameters = substr_count($headerText, '{{');
                $headerExample = $this->headerExample($component);
            }
            if ($type === 'BUTTONS') {
                foreach ((array) ($component['buttons'] ?? []) as $button) {
                    if (! is_array($button)) {
                        continue;
                    }
                    $buttonType = strtoupper((string) ($button['type'] ?? 'QUICK_REPLY'));
                    $encoded = json_encode($button);
                    $hasParameter = is_string($encoded) && str_contains($encoded, '{{');
                    if ($hasParameter) {
                        $buttonParameters++;
                    }
                    $buttonSummary[] = [
                        'type' => $buttonType,
                        'text' => (string) ($button['text'] ?? ''),
                        'url' => (string) ($button['url'] ?? ''),
                        'has_parameter' => $hasParameter,
                    ];
                }
            }
        }

        if ($body === null || trim($body) === '') {
            $unsupported ??= 'This template has no readable message body.';
        }

        if (! in_array($format, ['POSITIONAL', 'NAMED'], true)) {
            $unsupported ??= 'Meta uses an unsupported parameter format for this template.';
        }

        $placeholders = [];
        if ($body !== null) {
            $placeholders = $format === 'NAMED'
                ? $this->namedPlaceholders($body)
                : $this->positionalPlaceholders($body);
            if ($placeholders === [] && str_contains($body, '{{')) {
                $unsupported ??= 'This template uses parameter syntax this system cannot map safely.';
            }
        }

        $name = (string) ($row['name'] ?? '');
        $language = (string) ($row['language'] ?? '');
        $category = isset($row['category']) ? (string) $row['category'] : null;

        return [
            'meta_template_id' => (string) ($row['id'] ?? ''),
            'name' => $name,
            'language' => $language,
            'category' => $category,
            'status' => isset($row['status']) ? (string) $row['status'] : null,
            'parameter_format' => $format,
            'components' => $components,
            'body' => $body,
            'footer' => $footer,
            'placeholders' => $placeholders,
            'header_type' => $headerType,
            'header_example' => $headerExample,
            'header_parameter_count' => $headerParameters,
            'button_summary' => $buttonSummary,
            'button_parameter_count' => $buttonParameters,
            'supported' => $unsupported === null,
            'unsupported_reason' => $unsupported,
            'remote_hash' => $this->remoteHash($name, $language, (string) $category, $format, $components),
        ];
    }

    /** Public example Meta shows for a media header, when it exposes one. */
    private function headerExample(array $component): ?string
    {
        $example = $component['example'] ?? null;
        if (! is_array($example)) {
            return null;
        }

        foreach ($example as $value) {
            if (is_array($value) && isset($value[0]) && is_string($value[0])) {
                return $value[0];
            }
            if (is_string($value)) {
                return $value;
            }
        }

        return null;
    }

    /** @return list<string> */
    private function namedPlaceholders(string $body): array
    {
        preg_match_all('/\{\{\s*([a-z0-9_]+)\s*\}\}/i', $body, $matches);
        $keys = [];
        foreach ($matches[1] as $key) {
            if (! in_array($key, $keys, true)) {
                $keys[] = $key;
            }
        }

        return $keys;
    }

    /** @return list<string> */
    private function positionalPlaceholders(string $body): array
    {
        preg_match_all('/\{\{\s*([0-9]+)\s*\}\}/', $body, $matches);
        $keys = array_values(array_unique($matches[1]));
        sort($keys, SORT_NUMERIC);

        return array_map('strval', $keys);
    }

    /**
     * Build the component list Meta expects.
     *
     * An existing template keeps its header and buttons untouched; only the body
     * wording changes. A new template can be created with a media header, which
     * needs a public sample link for Meta's review.
     *
     * @param  array{type?:string,sample?:string}|null  $header
     * @return list<array<string,mixed>>
     */
    private function outboundComponents(WhatsAppMetaTemplate|array|null $catalog, string $remoteBody, ?array $header = null): array
    {
        $components = [];
        $replaced = false;
        $existing = $catalog instanceof WhatsAppMetaTemplate
            ? (array) $catalog->components
            : (array) ($catalog['components'] ?? []);
        $format = $catalog instanceof WhatsAppMetaTemplate
            ? (string) ($catalog->parameter_format ?? 'POSITIONAL')
            : (string) ($catalog['parameter_format'] ?? 'POSITIONAL');

        foreach ($existing as $component) {
            if (is_array($component) && strtoupper((string) ($component['type'] ?? '')) === 'BODY' && ! $replaced) {
                $component['text'] = $remoteBody;
                unset($component['example']);
                $component['example'] = $this->bodyExample($remoteBody, $format);
                $replaced = true;
            }
            $components[] = $component;
        }

        if (! $replaced) {
            $components[] = [
                'type' => 'BODY',
                'text' => $remoteBody,
                'example' => $this->bodyExample($remoteBody, 'POSITIONAL'),
            ];
        }

        if (! $existing && $header && ($header['type'] ?? null) && ($header['sample'] ?? null)) {
            array_unshift($components, $this->headerComponent((string) $header['type'], (string) $header['sample']));
        }

        return $components;
    }

    /**
     * @return array<string,mixed>
     */
    private function headerComponent(string $type, string $sample): array
    {
        $type = strtoupper($type);
        $key = match ($type) {
            'VIDEO' => 'video',
            'AUDIO' => 'audio',
            'DOCUMENT' => 'document',
            default => 'image',
        };

        return [
            'type' => 'HEADER',
            'format' => $type === 'DOCUMENT' ? 'DOCUMENT' : $type,
            'example' => ['header_handle' => [$sample]],
        ];
    }

    /** @return array<string,mixed> */
    private function bodyExample(string $body, string $format): array
    {
        $samples = ['Asha Verma', 'Carehaven', 'Dr Mehta', '21 Oct 2026', '10:30', 'Follow-up', 'https://example.com/portal', 'INV-1001', '500', 'Your prescription is ready.'];

        if ($format === 'NAMED') {
            $params = [];
            foreach ($this->namedPlaceholders($body) as $index => $name) {
                $params[] = ['param_name' => $name, 'example' => $samples[$index % count($samples)]];
            }

            return ['body_text_named_params' => $params];
        }

        $values = [];
        foreach ($this->positionalPlaceholders($body) as $index => $key) {
            $values[(int) $key - 1] = $samples[$index % count($samples)];
        }
        ksort($values);

        return ['body_text' => [array_values($values)]];
    }

    /** @param list<array<string,mixed>> $components */
    private function remoteHash(string $name, string $language, string $category, ?string $format, array $components): string
    {
        return hash('sha256', $this->canonicalJson([
            'name' => $name,
            'language' => $language,
            'category' => $category,
            'parameter_format' => $format,
            'components' => $components,
        ]));
    }

    private function localHash(string $name, string $body): string
    {
        return hash('sha256', $this->canonicalJson(['name' => $name, 'body' => $body]));
    }

    private function canonicalJson(mixed $value): string
    {
        $normalized = $this->canonical($value);

        try {
            return json_encode($normalized, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        } catch (JsonException) {
            return '';
        }
    }

    private function canonical(mixed $value): mixed
    {
        if ($value instanceof stdClass) {
            $value = get_object_vars($value);
        }
        if (is_array($value)) {
            if (! array_is_list($value)) {
                ksort($value, SORT_STRING);
            }

            return array_map(fn (mixed $item): mixed => $this->canonical($item), $value);
        }

        return $value;
    }

    private function markPublishAttempt(WhatsAppTemplate $local, string $desiredHash, string $action, array $bindings): void
    {
        $local->forceFill([
            'bindings' => $bindings,
            'sync_state' => 'uncertain',
            'pending_hash' => $desiredHash,
            'pending_action' => $action,
            'sync_error' => null,
        ])->save();
    }

    private function markUncertain(WhatsAppTemplate $local, string $message): void
    {
        $local->forceFill(['sync_state' => 'uncertain', 'sync_error' => $message])->save();
    }

    /** @param array<string,mixed> $confirmed */
    private function storeConfirmed(WhatsAppTemplate $local, string $wabaId, array $confirmed): void
    {
        WhatsAppMetaTemplate::query()->updateOrCreate(
            ['waba_id' => $wabaId, 'meta_template_id' => (string) $confirmed['meta_template_id']],
            $confirmed + ['missing' => false, 'last_synced_at' => now()],
        );

        $local->forceFill([
            'meta_template_id' => (string) $confirmed['meta_template_id'],
            'template_name' => $confirmed['name'],
            'language' => $confirmed['language'],
            'category' => $confirmed['category'],
            'baseline_hash' => $confirmed['remote_hash'],
            'baseline_local_hash' => $this->localHash($local->template_name, $local->body),
            'sync_state' => $confirmed['status'] === 'APPROVED' ? 'synced' : 'pending',
            'pending_hash' => null,
            'pending_action' => null,
            'sync_error' => null,
            'last_synced_at' => now(),
            'revision' => $local->revision + 1,
        ])->save();
    }

    private function safeError(mixed $message, string $fallback): string
    {
        if (! is_string($message) || trim($message) === '') {
            return $fallback;
        }

        $clean = preg_replace('/EAA[A-Za-z0-9]+/', '[redacted]', $message) ?? $message;

        return mb_substr($clean, 0, 300);
    }

    private function endpoint(string $path): string
    {
        return rtrim((string) config('whatsapp.api_base'), '/').'/'.config('whatsapp.graph_version').'/'.ltrim($path, '/');
    }

    private function graph(string $token): PendingRequest
    {
        return Http::withToken($token)
            ->acceptJson()
            ->asJson()
            ->connectTimeout(5)
            ->timeout((int) config('whatsapp.timeout', 10))
            ->withoutRedirecting();
    }
}
