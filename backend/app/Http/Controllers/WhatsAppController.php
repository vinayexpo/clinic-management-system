<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\Patient;
use App\Models\WhatsAppConnection;
use App\Models\WhatsAppMessage;
use App\Support\ApiHelpers;
use App\Support\Phone;
use App\Support\WhatsAppDispatcher;
use App\Support\WhatsAppSender;
use App\Support\WhatsAppTemplateSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

class WhatsAppController extends Controller
{
    use ApiHelpers;

    /**
     * Connection state and the templates the clinic can edit.
     */
    public function status(Request $request, WhatsAppDispatcher $dispatcher, WhatsAppTemplateSync $sync): JsonResponse
    {
        $this->requireRole($request, 'admin');

        $templates = [];
        foreach (array_keys((array) config('whatsapp.default_templates', [])) as $event) {
            $template = $dispatcher->template($event);
            if ($template) {
                $templates[] = $sync->describe($template);
            }
        }

        $connection = WhatsAppConnection::find(1);
        $sender = WhatsAppSender::resolve();

        return $this->ok([
            'enabled' => (bool) config('whatsapp.enabled'),
            'log_only' => (bool) config('whatsapp.log_only'),
            'configured' => $sender !== null,
            'phone_number_id' => $sender['phone_number_id'] ?? null,
            'sender' => WhatsAppSender::describe(),
            'coexistence' => [
                'ready' => (bool) config('whatsapp.coexistence_ready') && config('whatsapp.app_id')
                    && config('whatsapp.app_secret') && config('whatsapp.signup_config_id')
                    && config('whatsapp.webhook_verify_token'),
                'connection' => $connection,
                'webhook_url' => url('/api/v1/whatsapp/webhook'),
                'required_webhook_fields' => ['messages', 'account_update', 'history', 'smb_app_state_sync', 'smb_message_echoes'],
            ],
            'reminder_lead_hours' => (int) config('whatsapp.reminder_lead_hours', 24),
            'country_code' => config('whatsapp.country_code'),
            'templates' => $templates,
        ]);
    }

    /**
     * Update a template. The body may contain {{placeholders}}; their values are sent
     * to WhatsApp as template parameters in the order they appear.
     */
    public function updateTemplate(Request $request, string $event, WhatsAppDispatcher $dispatcher, WhatsAppTemplateSync $sync): JsonResponse
    {
        $this->requireRole($request, 'admin');
        abort_unless(array_key_exists($event, (array) config('whatsapp.default_templates', [])), 404, 'Unknown template event.');

        $data = $request->validate([
            'template_name' => 'required|string|max:120',
            'body' => 'required|string|max:2000',
            'is_active' => 'sometimes|boolean',
            'media_url' => 'sometimes|nullable|string|max:500',
            'expected_revision' => 'sometimes|integer|min:1',
        ]);

        $template = $dispatcher->template($event);
        abort_unless($template, 404, 'Unknown template event.');

        if (array_key_exists('expected_revision', $data)) {
            abort_unless($template->revision === $data['expected_revision'], 409, 'This template changed elsewhere. Reload before saving.');
        }

        $template->forceFill([
            'template_name' => $data['template_name'],
            'body' => $data['body'],
            'is_active' => $data['is_active'] ?? $template->is_active,
            'media_url' => array_key_exists('media_url', $data) ? $data['media_url'] : $template->media_url,
            'sync_error' => null,
        ]);
        $sync->noteLocalEdit($template);
        $template->forceFill(['revision' => $template->revision + 1])->save();

        return $this->ok($sync->describe($template->fresh()));
    }

    /**
     * Send a test message to any number, to confirm the number and template work.
     */
    /**
     * Send a one-off WhatsApp message to a patient.
     *
     * Uses the "manual" template, so the message is business-initiated: the patient
     * must have opted in and the template must be approved by Meta.
     */
    public function sendToPatient(Request $request, WhatsAppDispatcher $dispatcher): JsonResponse
    {
        $this->requireRole($request, 'admin', 'doctor', 'receptionist');
        $data = $request->validate([
            'patient_id' => ['required', 'integer', 'min:1'],
            'message' => ['required', 'string', 'max:1000'],
        ]);

        $patient = Patient::query()->find($data['patient_id']);
        abort_unless($patient, 404, 'Unknown patient.');

        $values = $dispatcher->values($patient, null, ['message' => trim($data['message'])]);
        $result = $dispatcher->send($patient, 'manual', $values);

        if ($result['status'] === 'skipped') {
            abort(422, $result['error']);
        }

        $this->audit(
            $request,
            $result['status'] === 'sent' ? 'sent' : 'failed',
            'patient',
            $patient->id,
            'Manual WhatsApp message '.$result['status'].'.',
        );

        return $this->ok(['status' => $result['status'], 'error' => $result['error']]);
    }

    /**
     * Which WhatsApp account staff should use, so the app can send through the API
     * or hand the message to WhatsApp directly.
     */
    public function senderState(Request $request): JsonResponse
    {
        $this->requireRole($request, 'admin', 'doctor', 'receptionist');

        return $this->ok(WhatsAppSender::describe() + ['country_code' => (string) config('whatsapp.country_code', '91')]);
    }

    public function sendTest(Request $request, WhatsAppDispatcher $dispatcher, WhatsAppTemplateSync $sync): JsonResponse
    {
        $this->requireRole($request, 'admin');
        abort_unless(config('whatsapp.enabled'), 422, 'WhatsApp sending is disabled on the server. Connecting a number does not enable delivery.');
        $data = $request->validate([
            'phone' => 'required|string|max:32',
            'message' => 'required|string|max:1000',
        ]);

        $to = Phone::toE164($data['phone']);
        abort_unless($to, 422, 'That phone number is not a valid international number.');

        $template = $dispatcher->template('manual');
        abort_unless($template?->is_active, 422, 'The manual message template is disabled.');
        $values = [
            'patient_name' => 'Test',
            'clinic_name' => (string) config('app.name'),
            'message' => $data['message'],
        ];
        $remote = null;
        if (! config('whatsapp.log_only')) {
            try {
                $remote = $sync->outbound($template, $values);
            } catch (RuntimeException $e) {
                abort(422, $e->getMessage());
            }
        }
        [$body, $parameters] = $dispatcher->render($template->body, $values);

        $message = WhatsAppMessage::create([
            'event' => 'manual',
            'to_number' => $to,
            'rendered_body' => $body,
            'parameters' => $parameters,
            'status' => 'pending',
        ]);

        if (config('whatsapp.log_only')) {
            $message->update(['status' => 'logged', 'sent_at' => now()]);

            return $this->ok(['status' => 'logged', 'message' => $message->fresh()]);
        }

        $result = $dispatcher->client()->sendTemplate($to, $remote['name'], $remote['parameters'], $remote['language']);
        $message->update([
            'status' => $result['ok'] ? 'sent' : 'failed',
            'error' => $result['error'],
            'provider_message_id' => $result['message_id'],
            'sent_at' => $result['ok'] ? now() : null,
        ]);

        return $this->ok(['status' => $result['ok'] ? 'sent' : 'failed', 'error' => $result['error'], 'message' => $message->fresh()]);
    }

    /**
     * The message log, for auditing what was sent to patients.
     */
    public function messages(Request $request): JsonResponse
    {
        $this->requireRole($request, 'admin');

        $perPage = min(100, max(1, $request->integer('per_page', 20)));
        $query = WhatsAppMessage::query()->with('patient');

        if ($request->filled('event')) {
            $query->where('event', $request->string('event')->toString());
        }
        if ($request->filled('status')) {
            $query->where('status', $request->string('status')->toString());
        }
        if ($request->filled('patient_id')) {
            $query->where('patient_id', $request->integer('patient_id'));
        }
        if ($request->filled('search')) {
            $term = '%'.addcslashes($request->string('search')->toString(), '%_\\');
            $query->where(fn ($q) => $q->where('rendered_body', 'like', $term)->orWhere('to_number', 'like', $term));
        }

        return $this->ok($query->latest('id')->paginate($perPage));
    }

    /**
     * Messages sent to one patient, shown on their record.
     */
    public function patientMessages(Request $request, Patient $patient): JsonResponse
    {
        $this->requireRole($request, 'admin', 'doctor', 'receptionist');

        return $this->ok(
            WhatsAppMessage::query()
                ->where('patient_id', $patient->id)
                ->latest('id')
                ->paginate(min(50, max(1, $request->integer('per_page', 10))))
        );
    }

    /**
     * Send a reminder for one appointment on demand.
     */
    public function remind(Request $request, Appointment $appointment, WhatsAppDispatcher $dispatcher): JsonResponse
    {
        $this->requireRole($request, 'admin', 'receptionist');
        $appointment->loadMissing(['patient', 'doctor']);

        $values = $dispatcher->values($appointment->patient, $appointment);
        $result = $dispatcher->send($appointment->patient, 'appointment_reminder', $values, $appointment);

        if (in_array($result['status'], ['sent', 'logged'], true)) {
            $appointment->update(['reminder_sent_at' => now(), 'reminder_kind' => 'manual']);
        }

        return $this->ok($result, $result['status'] === 'failed' ? 502 : 200);
    }

    /**
     * Record (or withdraw) a patient's consent to receive WhatsApp messages.
     */
    public function setConsent(Request $request, Patient $patient): JsonResponse
    {
        $this->requireRole($request, 'admin', 'receptionist');
        $data = $request->validate(['whatsapp_opt_in' => 'required|boolean']);

        $patient->update(['whatsapp_opt_in' => $data['whatsapp_opt_in']]);

        return $this->ok($patient->fresh());
    }

    /**
     * Preview a template with sample values, so the clinic can check the wording.
     */
    public function preview(Request $request, string $event, WhatsAppDispatcher $dispatcher): JsonResponse
    {
        $this->requireRole($request, 'admin');
        $template = $dispatcher->template($event);
        abort_unless($template, 404, 'Unknown template event.');

        [$body, $parameters] = $dispatcher->render($template->body, [
            'patient_name' => 'Asha Verma',
            'clinic_name' => 'Carehaven',
            'doctor_name' => 'Dr Mehta',
            'appointment_date' => '21 Oct 2026',
            'appointment_time' => '10:30',
            'reason' => 'Follow-up',
            'portal_link' => rtrim((string) config('app.frontend_url'), '/').'/portal',
            'invoice_number' => 'INV-1001',
            'amount' => '500',
            'message' => 'Your prescription is ready.',
        ]);

        return $this->ok(['body' => $body, 'parameters' => $parameters]);
    }
}
