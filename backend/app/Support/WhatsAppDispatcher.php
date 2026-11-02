<?php

namespace App\Support;

use App\Models\Appointment;
use App\Models\ClinicSetting;
use App\Models\Patient;
use App\Models\WhatsAppMessage;
use App\Models\WhatsAppTemplate;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Renders WhatsApp templates, sends them, and records every attempt.
 */
class WhatsAppDispatcher
{
    public function __construct(private readonly WhatsAppClient $client) {}

    /** The underlying API client, for sends that are not tied to a patient record. */
    public function client(): WhatsAppClient
    {
        return $this->client;
    }

    /**
     * Send a templated message to a patient.
     *
     * @param  array<string, string>  $values  Placeholder values, e.g. ['patient_name' => 'Asha'].
     * @return array{status:string,message:?WhatsAppMessage,error:?string}
     */
    public function send(Patient $patient, string $event, array $values = [], ?Appointment $appointment = null, bool $ignoreConsent = false): array
    {
        if (! config('whatsapp.enabled')) {
            return ['status' => 'skipped', 'message' => null, 'error' => 'WhatsApp reminders are turned off.'];
        }

        if (! $ignoreConsent && ! $patient->whatsapp_opt_in) {
            return ['status' => 'skipped', 'message' => null, 'error' => 'The patient has not opted in to WhatsApp messages.'];
        }

        $to = Phone::toE164($patient->phone);
        if (! $to) {
            return ['status' => 'skipped', 'message' => null, 'error' => 'The patient has no usable phone number.'];
        }

        $template = $this->template($event);
        if (! $template) {
            return ['status' => 'skipped', 'message' => null, 'error' => 'No WhatsApp template is configured for "'.$event.'".'];
        }

        [$body, $parameters] = $this->render($template->body, $values);

        $message = WhatsAppMessage::create([
            'patient_id' => $patient->id,
            'appointment_id' => $appointment?->id,
            'event' => $event,
            'to_number' => $to,
            'rendered_body' => $body,
            'parameters' => $parameters,
            'status' => 'pending',
        ]);

        if (config('whatsapp.log_only')) {
            $message->update(['status' => 'logged', 'sent_at' => now()]);

            return ['status' => 'logged', 'message' => $message, 'error' => null];
        }

        try {
            $remote = app(WhatsAppTemplateSync::class)->outbound($template, $values);
        } catch (RuntimeException $e) {
            $message->update(['status' => 'failed', 'error' => $e->getMessage()]);

            return ['status' => 'failed', 'message' => $message->fresh(), 'error' => $e->getMessage()];
        }

        $result = $this->client->sendTemplate($to, $remote['name'], $remote['parameters'], $remote['language'], $remote['header'] ?? null);

        $message->update([
            'status' => $result['ok'] ? 'sent' : 'failed',
            'error' => $result['error'],
            'provider_message_id' => $result['message_id'],
            'sent_at' => $result['ok'] ? now() : null,
        ]);

        if (! $result['ok']) {
            Log::warning('WhatsApp message failed.', ['patient_id' => $patient->id, 'event' => $event, 'error' => $result['error']]);
        }

        return ['status' => $result['ok'] ? 'sent' : 'failed', 'message' => $message->fresh(), 'error' => $result['error']];
    }

    /**
     * Replace {{placeholders}} with values and collect the values in order of appearance,
     * which is the order WhatsApp expects for template parameters.
     *
     * @param  array<string, string>  $values
     * @return array{0:string,1:list<string>}
     */
    public function render(string $templateBody, array $values): array
    {
        $parameters = [];
        $body = preg_replace_callback('/\{\{\s*([a-z0-9_]+)\s*\}\}/i', function (array $matches) use ($values, &$parameters): string {
            $value = (string) ($values[$matches[1]] ?? '');
            $parameters[] = $value;

            return $value;
        }, $templateBody) ?? $templateBody;

        return [$body, $parameters];
    }

    public function template(string $event): ?WhatsAppTemplate
    {
        $template = WhatsAppTemplate::query()->where('event', $event)->first();
        if ($template) {
            return $template;
        }

        $default = config('whatsapp.default_templates.'.$event);
        if (! $default) {
            return null;
        }

        return WhatsAppTemplate::query()->create([
            'event' => $event,
            'template_name' => $default['name'],
            'body' => $default['body'],
            'is_active' => true,
        ]);
    }

    /**
     * Values available to every template for a given patient and appointment.
     *
     * @return array<string, string>
     */
    public function values(Patient $patient, ?Appointment $appointment = null, array $extra = []): array
    {
        $clinic = ClinicSetting::query()->first();
        $values = [
            'patient_name' => trim(($patient->first_name ?? '').' '.($patient->last_name ?? '')) ?: 'there',
            'clinic_name' => (string) ($clinic?->clinic_name ?: config('app.name')),
            'doctor_name' => (string) ($appointment?->doctor?->display_name ?? 'our doctor'),
            'appointment_date' => $appointment?->appointment_date?->format('d M Y') ?? '',
            'appointment_time' => $appointment ? (string) substr((string) $appointment->start_time, 0, 5) : '',
            'reason' => (string) ($appointment?->reason_for_visit ?? 'consultation'),
            'portal_link' => rtrim((string) config('app.frontend_url'), '/').'/portal',
            'invoice_number' => (string) ($extra['invoice_number'] ?? ''),
            'amount' => (string) ($extra['amount'] ?? ''),
            'message' => (string) ($extra['message'] ?? ''),
        ];

        return $values;
    }
}
