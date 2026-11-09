<?php

namespace App\Http\Controllers;

use App\Models\AiSetting;
use App\Models\AuditLog;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\Visit;
use App\Support\AiGateway;
use App\Support\AiGatewayException;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * The clinic's connection to its own OpenAI-compatible provider, plus the
 * assist endpoints that turn stored clinic data into draft notes, prescription
 * rows and patient summaries. Every assist result stays a draft until a staff
 * member confirms it in the interface.
 */
class AiController extends Controller
{
    /** Feature keys the interface may switch off, with the labels shown in Settings. */
    public const FEATURES = [
        'consultation' => 'Consultation note drafts',
        'prescription' => 'Prescription drafts',
        'patient_summary' => 'Patient history summaries',
        'assistant' => 'Clinic assistant',
    ];

    // ---- Configuration (administrators) ----

    /** Configuration state for any staff member: which provider, model and features. */
    public function status(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist']);
        $setting = AiSetting::current();

        return $this->ok([
            'configured' => $setting?->configured() ?? false,
            'model' => $setting?->model,
            'provider_host' => $this->host($setting?->base_url),
            'features' => self::featureFlags($setting),
        ]);
    }

    /** The editable configuration with a masked key. Administrators only. */
    public function config(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin']);
        $setting = AiSetting::current() ?? new AiSetting;

        return $this->ok([
            'base_url' => $setting->base_url,
            'api_key_masked' => $setting->configured() || filled($setting->api_key) ? $setting->maskedKey() : null,
            'has_api_key' => filled($setting->api_key),
            'model' => $setting->model,
            'features' => self::featureFlags($setting),
        ]);
    }

    /** Save the provider URL, key (only when re-entered), model and feature switches. */
    public function saveConfig(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin']);
        $d = $r->validate([
            'base_url' => ['required', 'url:https', 'max:500'],
            'api_key' => ['nullable', 'string', 'min:8', 'max:400'],
            'model' => ['required', 'string', 'max:160'],
            'features' => ['nullable', 'array', 'max:4'],
            'features.*' => ['boolean'],
        ]);

        $setting = AiSetting::current() ?? new AiSetting;
        $setting->base_url = rtrim(trim($d['base_url']), '/');
        $setting->model = trim($d['model']);
        $setting->features = $this->validatedFeatures($d['features'] ?? null);
        if (filled($d['api_key'] ?? null)) {
            $setting->api_key = trim($d['api_key']);
        }
        $setting->save();

        $this->audit($r, 'updated', 'ai_settings', $setting->id, "AI settings updated (model {$setting->model}).");

        return $this->ok([
            'base_url' => $setting->base_url,
            'api_key_masked' => $setting->maskedKey(),
            'has_api_key' => filled($setting->api_key),
            'model' => $setting->model,
            'features' => self::featureFlags($setting),
        ]);
    }

    /**
     * List the models available behind the given API URL and key. When either is
     * left empty, the saved configuration is used so the form can be re-tested
     * without re-typing the key.
     */
    public function fetchModels(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin']);
        $d = $r->validate([
            'api_url' => ['sometimes', 'string', 'max:500'],
            'api_key' => ['sometimes', 'string', 'max:400'],
        ]);

        $url = filled($d['api_url'] ?? null) ? rtrim(trim($d['api_url']), '/') : AiSetting::current()?->base_url;
        $key = filled($d['api_key'] ?? null) ? trim($d['api_key']) : AiSetting::current()?->api_key;
        abort_if(! filled($url) || ! filled($key), 422, 'Enter an API URL and an API key first.');

        try {
            ['models' => $models, 'resolved_url' => $resolved] = AiGateway::models($url, $key);
        } catch (AiGatewayException $e) {
            abort(422, $e->getMessage());
        }

        return $this->ok(['models' => $models, 'resolved_url' => $resolved]);
    }

    // ---- Assist endpoints (draft generation) ----

    /**
     * Draft clinical notes for a visit from its recorded symptoms, vitals and the
     * patient's recent history. Returns fields for the doctor to review and insert.
     */
    public function consultationAssist(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor']);
        $d = $r->validate([
            'visit_id' => ['required', 'integer'],
            'instructions' => ['nullable', 'string', 'max:2000'],
            'current_symptoms' => ['nullable', 'string', 'max:2000'],
            'current_vitals' => ['nullable', 'array'],
            'current_exam' => ['nullable', 'string', 'max:2000'],
            'current_diagnosis' => ['nullable', 'string', 'max:500'],
            'current_plan' => ['nullable', 'string', 'max:2000'],
        ]);
        $setting = $this->setting($r, 'consultation');

        $visit = Visit::query()->with(['patient', 'doctor'])->find($d['visit_id']);
        abort_unless($visit, 404, 'Visit not found.');
        $patient = $visit->patient;
        abort_unless($patient, 404, 'The visit has no patient record.');

        $history = [$visit, ...Visit::query()
            ->with('doctor')
            ->where('patient_id', $patient->id)
            ->where('id', '!=', $visit->id)
            ->orderByDesc('visit_date')->orderByDesc('id')
            ->limit(4)->get()];

        $symptoms = filled($d['current_symptoms'] ?? null) ? trim($d['current_symptoms']) : ($visit->symptoms ?: 'none recorded');
        $vitals = ! empty($d['current_vitals']) ? $d['current_vitals'] : ($visit->vitals ?? []);
        $vitalsFormatted = collect($vitals)
            ->filter(fn ($v) => filled($v))
            ->map(fn ($v, $k) => "{$k}: {$v}")
            ->implode(', ');

        $context = $this->patientBlock($patient)."\n".
            'Recorded allergies: '.($patient->allergies_summary ?: 'none recorded')."\n".
            "Presenting symptoms: {$symptoms}\n".
            "Recorded vitals: ".($vitalsFormatted ?: 'none')."\n";

        if (filled($d['current_exam'] ?? null)) {
            $context .= "Clinician examination findings/rough notes: ".trim($d['current_exam'])."\n";
        }
        if (filled($d['current_diagnosis'] ?? null)) {
            $context .= "Current working diagnosis: ".trim($d['current_diagnosis'])."\n";
        }
        if (filled($d['current_plan'] ?? null)) {
            $context .= "Current treatment plan: ".trim($d['current_plan'])."\n";
        }
        if (filled($d['instructions'] ?? null)) {
            $context .= "Clinician instruction or prompt: ".trim($d['instructions'])."\n";
        }

        $context .= "Previous consultations:\n".$this->visitLines($history);

        $prompt = $context."\n\n".
            'Act as an expert clinical documentation assistant for a physician. '.
            'Draft concise, professional, structured clinical notes for this patient visit. '.
            'Return JSON only (no markdown, no markdown fences) with keys: '.
            '"examination_notes", "diagnosis", "treatment_plan", "follow_up_suggestion" and "follow_up_date". '.
            'Rules: '.
            '- "examination_notes": 1-3 professional sentences detailing physical examination observations, vital signs interpretation, and relevant clinical findings. '.
            '- "diagnosis": concise medical diagnosis or clinical impression (short phrase, e.g. "Acute viral pharyngitis"). '.
            '- "treatment_plan": clear, organized steps for clinical management, supportive care, lifestyle recommendations, and non-pharmacological advice. '.
            '- "follow_up_suggestion": recommendation for re-evaluation interval and red-flag symptoms. '.
            '- "follow_up_date": date in "YYYY-MM-DD" format if a specific timeframe is suggested (today is '.now()->toDateString().') or "" if routine/as-needed. '.
            'Never invent unsupported laboratory results, imaging, or invasive procedures.';

        try {
            $raw = AiGateway::chat($setting->base_url, $setting->api_key, $setting->model, [
                ['role' => 'system', 'content' => self::jargonPrompt()],
                ['role' => 'user', 'content' => $prompt],
            ]);
        } catch (AiGatewayException $e) {
            Log::warning('AI consultation assist failed', ['error' => $e->getMessage()]);
            abort(422, $e->getMessage());
        }

        $draft = $this->extractObject($raw);
        abort_if(! $draft, 422, 'The AI reply was not the requested draft. Try again.');

        $fields = [];
        foreach (['examination_notes', 'diagnosis', 'treatment_plan', 'follow_up_suggestion', 'follow_up_date'] as $key) {
            if (array_key_exists($key, $draft) && is_string($draft[$key])) {
                $fields[$key] = trim($draft[$key]);
            }
        }
        if (count($fields) < 2) {
            abort(422, 'The AI reply was missing draft fields. Try again.');
        }
        $this->audit($r, 'created', 'visit', $visit->id, "AI drafted clinical notes for {$visit->visit_number}.");

        return $this->ok($fields);
    }

    /**
     * Draft prescription medicine rows from the visit's diagnosis and history.
     * Returns rows for the doctor to review and insert into a draft prescription.
     */
    public function prescriptionAssist(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor']);
        $d = $r->validate([
            'visit_id' => ['required', 'integer'],
            'instructions' => ['nullable', 'string', 'max:2000'],
        ]);
        $setting = $this->setting($r, 'prescription');

        $visit = Visit::query()->with(['patient', 'doctor'])->find($d['visit_id']);
        abort_unless($visit?->patient, 404, 'Visit not found.');
        $patient = $visit->patient;

        $prior = Prescription::query()
            ->where('patient_id', $patient->id)
            ->orderByDesc('created_at')->limit(2)
            ->with('items')->get();

        $context = $this->patientBlock($patient)."\n".
            'Recorded allergies: '.($patient->allergies_summary ?: 'none recorded')."\n".
            $this->symptomBlock($visit)."\n".
            "Recent medicines for this patient:\n".$this->prescriptionLines($prior)."\n".
            'Clinician instruction: '.(trim((string) ($d['instructions'] ?? '')) ?: 'none given');

        $prompt = $context."\n\n".
            'In JSON only, draft an outpatient prescription for this presentation. The JSON is either an array of items or an object {"items": [...]} with '.
            'items of keys "medicine_name", "strength", "dosage", "route", "frequency", "duration", "quantity" (integer) and "instructions". '.
            'Use widely available outpatient medicines at usual adult dosing, respect the recorded allergies, and keep 1-5 focused items. '.
            'If the presentation suggests no medicine, return an empty list.';

        try {
            $raw = AiGateway::chat($setting->base_url, $setting->api_key, $setting->model, [
                ['role' => 'system', 'content' => self::jargonPrompt()],
                ['role' => 'user', 'content' => $prompt],
            ]);
        } catch (AiGatewayException $e) {
            Log::warning('AI prescription assist failed', ['error' => $e->getMessage()]);
            abort(422, $e->getMessage());
        }

        $items = $this->extractItems($raw);
        abort_if($items === null, 422, 'The AI reply was not a usable medicine list. Try again.');

        $rows = [];
        foreach ($items as $item) {
            if (! is_array($item) || ! filled($item['medicine_name'] ?? null)) {
                continue;
            }
            $rows[] = [
                'medicine_name' => trim((string) $item['medicine_name']),
                'strength' => trim((string) ($item['strength'] ?? '')),
                'dosage' => trim((string) ($item['dosage'] ?? '')),
                'route' => trim((string) ($item['route'] ?? '')),
                'frequency' => trim((string) ($item['frequency'] ?? '')),
                'duration' => trim((string) ($item['duration'] ?? '')),
                'quantity' => is_numeric($item['quantity'] ?? null) ? (int) $item['quantity'] : null,
                'instructions' => trim((string) ($item['instructions'] ?? '')),
            ];
        }
        if ($rows === []) {
            abort(422, 'The AI suggested no medicine rows for this presentation.');
        }
        $this->audit($r, 'created', 'visit', $visit->id, "AI drafted prescription rows for {$visit->visit_number}.");

        return $this->ok(['items' => $rows]);
    }

    /** A short plain-language summary of one patient's whole recorded history. */
    public function patientSummary(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist']);
        $d = $r->validate(['patient_id' => ['required', 'integer']]);
        $setting = $this->setting($r, 'patient_summary');

        $patient = Patient::query()->find($d['patient_id']);
        abort_unless($patient, 404, 'Patient not found.');

        $visits = Visit::query()
            ->with('doctor')
            ->where('patient_id', $patient->id)
            ->orderByDesc('visit_date')->orderByDesc('id')
            ->limit(10)->get();

        if ($visits->isEmpty()) {
            abort(422, "{$patient->first_name} has no recorded consultations yet, so there is nothing to summarize.");
        }

        $prompt = $this->patientBlock($patient)."\n".
            'Recorded allergies: '.($patient->allergies_summary ?: 'none recorded')."\n".
            "Consultations:\n".$this->visitLines($visits)."\n\n".
            'In JSON only {"summary": "..."}, summarize the history in 3-5 plain sentences for clinic staff: '.
            'ongoing problems, recurring findings, medicines recorded so far, and anything notable. '.
            'Use only the facts above and say "not recorded" where a detail is missing.';

        try {
            $raw = AiGateway::chat($setting->base_url, $setting->api_key, $setting->model, [
                ['role' => 'system', 'content' => self::jargonPrompt()],
                ['role' => 'user', 'content' => $prompt],
            ]);
        } catch (AiGatewayException $e) {
            Log::warning('AI patient summary failed', ['error' => $e->getMessage()]);
            abort(422, $e->getMessage());
        }

        $draft = $this->extractObject($raw);
        $summary = trim((string) ($draft['summary'] ?? ''));
        if ($summary === '') {
            abort(422, 'The AI reply was not a patient summary. Try again.');
        }
        $this->audit($r, 'created', 'patient', $patient->id, "AI summarized the history of {$patient->patient_number}.");

        return $this->ok(['summary' => $summary]);
    }

    /** Ask the configured model a question in the light of one patient's records. */
    public function ask(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist']);
        $d = $r->validate([
            'question' => ['required', 'string', 'max:2000'],
            'patient_id' => ['nullable', 'integer'],
            'history' => ['nullable', 'array', 'max:30'],
        ]);
        $setting = $this->setting($r, 'assistant');

        $patient = filled($d['patient_id'] ?? null) ? Patient::query()->find($d['patient_id']) : null;
        abort_if(filled($d['patient_id'] ?? null) && ! $patient, 404, 'Patient not found.');

        if ($patient) {
            $recent = Visit::query()
                ->where('patient_id', $patient->id)
                ->orderByDesc('visit_date')->orderByDesc('id')
                ->limit(5)->get();
            $context = $this->patientBlock($patient)."\n".
                'Recorded allergies: '.($patient->allergies_summary ?: 'none recorded')."\n".
                "Recent consultations:\n".$this->visitLines($recent);
        } else {
            $context = 'No patient record is attached to this question.';
        }

        $turns = [];
        foreach (array_slice(is_array($d['history'] ?? null) ? $d['history'] : [], -6) as $turn) {
            if (! is_array($turn) || ! is_string($turn['content'] ?? null) || ! filled($turn['content'])) {
                continue;
            }
            $role = $turn['role'] ?? 'user';
            if (in_array($role, ['user', 'assistant'], true)) {
                $turns[] = ['role' => $role, 'content' => $turn['content']];
            }
        }

        $messages = [
            ['role' => 'system', 'content' => self::jargonPrompt()],
            ['role' => 'user', 'content' => $context."\n\nWhen the question touches on records, use only the facts above and say plainly what is not recorded."],
            ...$turns,
            ['role' => 'user', 'content' => (string) $d['question']],
        ];

        try {
            $answer = AiGateway::chat($setting->base_url, $setting->api_key, $setting->model, $messages, 0.3);
        } catch (AiGatewayException $e) {
            Log::warning('AI assistant failed', ['error' => $e->getMessage()]);
            abort(422, $e->getMessage());
        }

        return $this->ok(['answer' => $answer, 'model' => $setting->model]);
    }

    // ---- Shared helpers ----

    private function setting(Request $r, string $feature): AiSetting
    {
        $setting = AiSetting::current();
        abort_unless($setting?->configured(), 422, 'AI is not configured yet. An administrator can set it up in Settings.');
        abort_unless($setting->featureOn($feature), 403, 'That AI feature is switched off in Settings. An administrator can turn it on.');

        return $setting;
    }

    /** @return array<string, bool> */
    private static function featureFlags(?AiSetting $setting): array
    {
        $flags = [];
        foreach (self::FEATURES as $key => $label) {
            $flags[$key] = $setting?->featureOn($key) ?? true;
        }

        return $flags;
    }

    /** Store only the known feature keys as booleans. */
    private function validatedFeatures(mixed $input): ?array
    {
        if (! is_array($input)) {
            return null;
        }
        $out = [];
        foreach (self::FEATURES as $key => $label) {
            if (array_key_exists($key, $input) && is_bool($input[$key])) {
                $out[$key] = $input[$key];
            }
        }

        return $out;
    }

    private function host(?string $url): ?string
    {
        $host = parse_url((string) $url, PHP_URL_HOST);

        return $host ? $host : null;
    }

    private function patientBlock(Patient $patient): string
    {
        $age = $patient->date_of_birth ? Carbon::parse($patient->date_of_birth)->age : null;
        $sex = $patient->sex ? ucfirst((string) $patient->sex) : 'not recorded';

        return "Patient: {$patient->patient_number} ({$patient->first_name}".($patient->last_name ? " {$patient->last_name}" : '').'); '.
            "sex {$sex}; ".($age !== null ? "age {$age}" : 'age not recorded').'; '.
            'phone '.(filled($patient->phone) ? 'ends ...'.substr($patient->phone, -4) : 'not recorded').'.';
    }

    /**
     * One readable line per consultation, longest-relevant first as received.
     *
     * @param  iterable<Visit>  $visits
     */
    private function visitLines(iterable $visits): string
    {
        $lines = [];
        foreach ($visits as $visit) {
            $notes = filled($visit->symptoms) ? ' symptoms: '.trim(str_replace("\n", '; ', $visit->symptoms)) : '';
            $vitals = collect($visit->vitals ?? [])
                ->filter(fn ($v) => filled($v))
                ->map(fn ($v, $k) => "{$k}: {$v}")
                ->implode(', ');
            $plan = filled($visit->treatment_plan) ? ' plan: '.trim(str_replace("\n", '; ', $visit->treatment_plan)) : '';
            $lines[] = "- {$visit->visit_date?->format('Y-m-d')} {$visit->visit_number} ({$visit->status})".
                ': diagnosis '.($visit->diagnosis ?: 'not recorded').$notes.
                ($vitals !== '' ? ' vitals: '.$vitals : '').$plan;
        }

        return $lines === [] ? '- none recorded' : implode("\n", $lines);
    }

    private function symptomBlock(Visit $visit): string
    {
        $vitals = collect($visit->vitals ?? [])
            ->filter(fn ($v) => filled($v))
            ->map(fn ($v, $k) => "{$k}: {$v}")
            ->implode(', ');

        return 'This consultation: symptoms '.($visit->symptoms ?: 'not recorded').'; '.
            'recorded vitals '.($vitals !== '' ? $vitals : 'none').'; '.
            'examination notes '.(trim(str_replace("\n", '; ', (string) $visit->examination_notes)) ?: 'none').'; '.
            'current diagnosis '.($visit->diagnosis ?: 'not recorded').'; '.
            'treatment plan '.($visit->treatment_plan ?: 'not recorded').'.';
    }

    /** @param  iterable<Prescription>  $prescriptions */
    private function prescriptionLines(iterable $prescriptions): string
    {
        $lines = [];
        foreach (collect($prescriptions)->filter(fn ($p) => $p instanceof Prescription)->values() as $p) {
            foreach (($p->items ?? collect()) as $item) {
                $lines[] = "- {$item->medicine_name}".(filled($item->strength) ? " {$item->strength}" : '').
                    ", {$item->dosage}, {$item->frequency}, {$item->duration}".
                    (filled($item->instructions) ? ' ('.$item->instructions.')' : '');
            }
        }

        return $lines === [] ? '- none recorded' : implode("\n", $lines);
    }

    private static function jargonPrompt(): string
    {
        return 'You are a documentation assistant in a small outpatient clinic. '.
            'You help staff draft notes, summaries and answers grounded in the records they provide. '.
            'You follow formats exactly, output plain text or JSON as asked with no markdown fences, '.
            'and you never claim facts that are not in the provided context; say "not recorded" instead. '.
            'You write plain clinical language without marketing tone.';
    }

    /** Pull the first JSON object out of a model reply, tolerating code fences. */
    private function extractObject(?string $text): ?array
    {
        $data = $this->extractJson($text);

        return is_array($data) ? $data : null;
    }

    /**
     * Accept either a bare array of medicine rows or an object {"items": [...]}.
     *
     * @return array<int, mixed>|null
     */
    private function extractItems(?string $text): ?array
    {
        $data = $this->extractJson($text);
        if (! is_array($data)) {
            return null;
        }
        if (array_keys($data) === [0, 1, 2] || array_is_list($data)) {
            return $data;
        }

        return is_array($data['items'] ?? null) ? $data['items'] : null;
    }

    private function extractJson(?string $text): ?array
    {
        if (! is_string($text) || trim($text) === '') {
            return null;
        }
        $text = trim((string) preg_replace('/^```(?:json)?\s*|\s*```$/', '', trim($text)));
        if (preg_match('/\{.*\}|\[.*\]/s', $text, $match) !== 1) {
            return null;
        }
        try {
            $data = json_decode($match[0], true, 512, JSON_THROW_ON_ERROR);

            return is_array($data) ? $data : null;
        } catch (\JsonException) {
            return null;
        }
    }

    private function audit(Request $request, string $action, string $entityType, ?int $entityId, string $summary): void
    {
        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'summary' => $summary,
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'created_at' => now(),
        ]);
    }

    private function authorizeRoles(Request $r, array $roles): void
    {
        abort_unless($r->user() && in_array($r->user()->role, $roles, true), 403, 'Insufficient role.');
    }

    private function ok(mixed $data, int $status = 200): mixed
    {
        return response()->json(['data' => $data], $status);
    }
}
