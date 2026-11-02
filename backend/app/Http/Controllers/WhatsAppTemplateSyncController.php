<?php

namespace App\Http\Controllers;

use App\Models\WhatsAppTemplate;
use App\Support\ApiHelpers;
use App\Support\WhatsAppDispatcher;
use App\Support\WhatsAppTemplateSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Explicit two-way template synchronization with Meta.
 * Nothing here sends a patient message; publishing only submits wording for review.
 */
class WhatsAppTemplateSyncController extends Controller
{
    use ApiHelpers;

    public function index(Request $request, WhatsAppDispatcher $dispatcher, WhatsAppTemplateSync $sync): JsonResponse
    {
        $this->requireRole($request, 'admin');

        $locals = [];
        foreach (array_keys((array) config('whatsapp.default_templates', [])) as $event) {
            $template = $dispatcher->template($event);
            if ($template) {
                $locals[] = $sync->describe($template);
            }
        }

        $templates = $sync->catalogForCurrentAccount()->map(static fn ($template): array => [
            'id' => $template->id,
            'meta_id' => $template->meta_template_id,
            'name' => $template->name,
            'language' => $template->language,
            'category' => $template->category,
            'status' => $template->status,
            'parameter_format' => $template->parameter_format,
            'body' => $template->body,
            'footer' => $template->footer,
            'placeholders' => array_values((array) $template->placeholders),
            'header_type' => $template->header_type,
            'header_example' => $template->header_example,
            'buttons' => array_values((array) $template->button_summary),
            'button_parameter_count' => (int) $template->button_parameter_count,
            'supported' => (bool) $template->supported,
            'unsupported_reason' => $template->unsupported_reason,
            'missing' => (bool) $template->missing,
            'last_synced_at' => $template->last_synced_at?->toIso8601String(),
            'linked_event' => WhatsAppTemplate::query()->where('meta_template_id', $template->meta_template_id)->value('event'),
        ])->values();

        return $this->ok([
            'configured' => $sync->credentials() !== null,
            'last_pulled_at' => $sync->lastPulledAt(),
            'variables' => WhatsAppTemplateSync::VARIABLES,
            'locals' => $locals,
            'templates' => $templates,
        ]);
    }

    public function pull(Request $request, WhatsAppTemplateSync $sync): JsonResponse
    {
        $this->requireRole($request, 'admin');

        $result = $sync->pull();
        $this->audit($request, 'whatsapp.templates.pulled', 'WhatsAppTemplate', null, sprintf(
            'Pulled Meta templates: %d new, %d updated, %d conflicts.', $result['imported'], $result['updated'], $result['conflicts'],
        ));

        return $this->ok($result);
    }

    public function adopt(Request $request, string $event, WhatsAppDispatcher $dispatcher, WhatsAppTemplateSync $sync): JsonResponse
    {
        $this->requireRole($request, 'admin');
        abort_unless(array_key_exists($event, (array) config('whatsapp.default_templates', [])), 404, 'Unknown template event.');

        $data = $request->validate([
            'meta_template_id' => ['required', 'integer', 'min:1'],
            'expected_revision' => ['required', 'integer', 'min:1'],
            'bindings' => ['sometimes', 'array', 'max:30'],
            'bindings.*' => ['string', 'max:64'],
        ]);

        $template = $sync->adopt($event, $data['meta_template_id'], $data['bindings'] ?? [], $data['expected_revision']);
        $this->audit($request, 'whatsapp.templates.adopted', 'WhatsAppTemplate', $template->id, 'Imported Meta wording for '.$event.'.');

        return $this->ok($sync->describe($template));
    }

    /**
     * Unlink a clinic message type from its Meta template.
     *
     * The template stays in the Meta account; the clinic simply stops using it.
     */
    public function unlink(Request $request, string $event, WhatsAppDispatcher $dispatcher, WhatsAppTemplateSync $sync): JsonResponse
    {
        $this->requireRole($request, 'admin');
        abort_unless(array_key_exists($event, (array) config('whatsapp.default_templates', [])), 404, 'Unknown template event.');

        $template = $dispatcher->template($event);
        abort_unless($template, 404, 'Unknown template event.');
        abort_unless($template->meta_template_id, 422, 'This message type is not linked to a Meta template.');

        $template->forceFill([
            'meta_template_id' => null,
            'bindings' => null,
            'baseline_hash' => null,
            'baseline_local_hash' => null,
            'pending_hash' => null,
            'pending_action' => null,
            'sync_state' => 'local',
            'sync_error' => null,
            'revision' => $template->revision + 1,
        ])->save();
        $this->audit($request, 'updated', 'whatsapp_template', $template->id, 'Unlinked '.$event.' from its Meta template.');

        return $this->ok($sync->describe($template->fresh()));
    }

    public function publish(Request $request, string $event, WhatsAppDispatcher $dispatcher, WhatsAppTemplateSync $sync): JsonResponse
    {
        $this->requireRole($request, 'admin');
        abort_unless(array_key_exists($event, (array) config('whatsapp.default_templates', [])), 404, 'Unknown template event.');

        $data = $request->validate([
            'expected_revision' => ['required', 'integer', 'min:1'],
            'resolve' => ['sometimes', 'in:keep_local'],
            'header' => ['sometimes', 'nullable', 'array'],
            'header.type' => ['sometimes', 'in:IMAGE,VIDEO,AUDIO,DOCUMENT'],
            'header.sample' => ['sometimes', 'required_with:header.type', 'string', 'max:500', 'url'],
        ]);

        $result = $sync->publish(
            $event,
            $data['expected_revision'],
            ($data['resolve'] ?? null) === 'keep_local',
            $data['header'] ?? null,
        );
        $this->audit(
            $request,
            'whatsapp.templates.published',
            'WhatsAppTemplate',
            WhatsAppTemplate::query()->where('event', $event)->value('id'),
            'Submitted '.$event.' to Meta. Confirmed: '.($result['confirmed'] ? 'yes' : 'no').'.',
        );

        return $this->ok($result);
    }
}
