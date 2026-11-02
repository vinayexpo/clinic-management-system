<?php

namespace Tests\Feature;

use App\Models\AiSetting;
use App\Models\AuditLog;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\User;
use App\Models\Visit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AiFeatureTest extends TestCase
{
    use RefreshDatabase;

    private string $baseUrl = 'https://provider.example/v1';

    private const PROVIDER_KEY = 'sk-test-provider-key-1234567890';

    private const MASKED_KEY = '•••••••• 7890';

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    private function asUser(User $user): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($user->createToken('test')->plainTextToken);
    }

    private function configure(string $baseUrl = 'https://provider.example/v1', array $featureFlags = []): AiSetting
    {
        return AiSetting::create([
            'base_url' => $baseUrl,
            'api_key' => self::PROVIDER_KEY,
            'model' => 'care-model',
            'features' => $featureFlags === [] ? null : $featureFlags,
        ]);
    }

    private function visitWithPatient(): array
    {
        $admin = $this->admin();
        $doctorUser = User::factory()->create(['role' => 'doctor']);
        $doctor = Doctor::create(['user_id' => $doctorUser->id, 'display_name' => 'Dr Anand', 'consultation_fee' => 500, 'is_active' => true]);
        $patient = Patient::create([
            'patient_number' => 'PAT-AI-1', 'first_name' => 'Rhea', 'phone' => '9000090001',
            'sex' => 'female', 'date_of_birth' => '1990-04-02', 'created_by' => $admin->id,
        ]);
        $visit = Visit::create([
            'visit_number' => 'VIS-AI-1', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id,
            'visit_date' => today(), 'status' => 'draft', 'symptoms' => 'Sore throat, dry cough',
            'vitals' => ['temp' => '38.1'], 'created_by' => $admin->id,
        ]);

        return [$patient, $visit, $doctorUser];
    }

    public function test_an_administrator_saves_the_provider_and_lists_models(): void
    {
        Http::fake([$this->baseUrl.'/models' => Http::response([
            'data' => [['id' => 'model-b'], ['id' => 'model-a'], ['owned_by' => 'clinic', 'id' => 'model-a']],
        ], 200)]);

        $this->asUser($this->admin())
            ->putJson('/api/v1/ai/config', [
                'base_url' => $this->baseUrl,
                'api_key' => self::PROVIDER_KEY,
                'model' => 'model-a',
            ])
            ->assertOk()
            ->assertJsonPath('data.model', 'model-a')
            ->assertJsonPath('data.api_key_masked', self::MASKED_KEY)
            ->assertJsonMissingExact(['sk-test-provider-key-1234567890']);

        $this->asUser($this->admin())
            ->postJson('/api/v1/ai/models')
            ->assertOk()
            ->assertJsonCount(2, 'data.models')
            ->assertJsonPath('data.models.0.id', 'model-a')
            ->assertJsonPath('data.resolved_url', $this->baseUrl.'/models');

        $stored = AiSetting::query()->first();
        $this->assertNotSame(self::PROVIDER_KEY, $stored->getRawOriginal('api_key'));
    }

    public function test_a_rejected_key_is_surfaced_with_the_reason(): void
    {
        Http::fake([$this->baseUrl.'/models' => Http::response([
            'error' => ['message' => 'Incorrect API key provided.'],
        ], 401)]);

        $this->asUser($this->admin())
            ->postJson('/api/v1/ai/models', ['api_url' => $this->baseUrl, 'api_key' => 'sk-wrong'])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'The API key was rejected by the provider. Incorrect API key provided.');
    }

    public function test_a_host_without_a_version_segment_gets_one_automatically(): void
    {
        Http::fake([
            'https://provider.example/models' => Http::response('{"message": "Not Found"}', 404),
            'https://provider.example/v1/models' => Http::response(['data' => [['id' => 'deepseek-v3']]], 200),
        ]);

        $this->asUser($this->admin())
            ->postJson('/api/v1/ai/models', ['api_url' => 'https://provider.example', 'api_key' => self::PROVIDER_KEY])
            ->assertOk()
            ->assertJsonPath('data.resolved_url', 'https://provider.example/v1/models');
    }

    public function test_the_consultation_draft_is_returned_as_editable_fields(): void
    {
        $this->configure();
        [$patient, $visit] = $this->visitWithPatient();

        $draft = [
            'examination_notes' => 'Throat injected, no exudate.',
            'diagnosis' => 'Viral pharyngitis',
            'treatment_plan' => 'Hydration and antipyretics; review in two days.',
            'follow_up_suggestion' => 'Review visit in two days if fever persists.',
            'follow_up_date' => today()->addDays(2)->toDateString(),
        ];
        $this->fakeChat(
            'Sure! Here is the draft: '.json_encode($draft).'.',
            'https://provider.example/v1/chat/completions',
        );

        $this->asUser(User::factory()->create(['role' => 'doctor']))
            ->postJson('/api/v1/ai/assist/consultation', ['visit_id' => $visit->id])
            ->assertOk()
            ->assertJsonPath('data.diagnosis', 'Viral pharyngitis')
            ->assertJsonPath('data.follow_up_date', today()->addDays(2)->toDateString());

        $this->assertSame(1, AuditLog::query()->where('entity_type', 'visit')->where('entity_id', $visit->id)->count());
    }

    public function test_the_prescription_draft_normalizes_items(): void
    {
        $this->configure();
        [, $visit] = $this->visitWithPatient();

        $payload = ['items' => [
            ['medicine_name' => 'Cetirizine', 'strength' => '10 mg', 'dosage' => '1 tablet', 'route' => 'oral',
                'frequency' => 'Once at night', 'duration' => '3 days', 'quantity' => 3, 'instructions' => 'After food'],
        ]];
        $this->fakeChat('```json '.json_encode($payload).' ```');

        $this->asUser(User::factory()->create(['role' => 'doctor']))
            ->postJson('/api/v1/ai/assist/prescription', ['visit_id' => $visit->id])
            ->assertOk()
            ->assertJsonCount(1, 'data.items')
            ->assertJsonPath('data.items.0.medicine_name', 'Cetirizine')
            ->assertJsonPath('data.items.0.quantity', 3);
    }

    public function test_assists_refuse_until_the_clinic_configures_ai(): void
    {
        [, $visit] = $this->visitWithPatient();

        $this->asUser(User::factory()->create(['role' => 'doctor']))
            ->postJson('/api/v1/ai/assist/consultation', ['visit_id' => $visit->id])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'AI is not configured yet. An administrator can set it up in Settings.');
    }

    public function test_a_switched_off_feature_is_forbidden(): void
    {
        $this->configure('https://provider.example/v1', ['consultation' => false, 'prescription' => true]);
        [, $visit] = $this->visitWithPatient();

        $this->asUser(User::factory()->create(['role' => 'doctor']))
            ->postJson('/api/v1/ai/assist/consultation', ['visit_id' => $visit->id])
            ->assertForbidden()
            ->assertJsonPath('message', 'That AI feature is switched off in Settings. An administrator can turn it on.');

        Http::fake([
            'https://provider.example/v1/chat/completions' => Http::response(['choices' => [
                ['message' => ['content' => '{"items": [{"medicine_name": "ORS", "dosage": "1 sachet", "frequency": "Twice", "duration": "2 days"}]}'],
                ],
            ]], 200),
        ]);

        $this->asUser(User::factory()->create(['role' => 'doctor']))
            ->postJson('/api/v1/ai/assist/prescription', ['visit_id' => $visit->id])
            ->assertOk();
    }

    public function test_receptionists_never_reach_the_configuration_or_doctor_ends(): void
    {
        $receptionist = User::factory()->create(['role' => 'receptionist']);

        $this->asUser($receptionist)->getJson('/api/v1/ai/config')->assertForbidden();
        $this->asUser($receptionist)->putJson('/api/v1/ai/config', [
            'base_url' => 'https://provider.example/v1', 'model' => 'x',
        ])->assertForbidden();
        $this->asUser($receptionist)->postJson('/api/v1/ai/models')->assertForbidden();

        $this->configure();
        [, $visit] = $this->visitWithPatient();
        $this->asUser($receptionist)
            ->postJson('/api/v1/ai/assist/consultation', ['visit_id' => $visit->id])
            ->assertForbidden();
    }

    public function test_the_patient_summary_needs_recorded_consultations(): void
    {
        $this->configure();
        [$patient] = $this->visitWithPatient();

        Http::fake(['https://provider.example/v1/chat/completions' => Http::response(['choices' => [
            ['message' => ['content' => '{"summary": "Two clinic visits; recent fever resolved."}']],
        ]], 200)]);

        $this->asUser(User::factory()->create(['role' => 'receptionist']))
            ->postJson('/api/v1/ai/assist/patient-summary', ['patient_id' => $patient->id])
            ->assertOk()
            ->assertJsonPath('data.summary', 'Two clinic visits; recent fever resolved.');

        Patient::create(['patient_number' => 'PAT-EMPTY', 'first_name' => 'New', 'phone' => '9000012345']);

        $this->asUser(User::factory()->create(['role' => 'admin']))
            ->postJson('/api/v1/ai/assist/patient-summary', ['patient_id' => Patient::query()->where('patient_number', 'PAT-EMPTY')->value('id')])
            ->assertUnprocessable();
    }

    private function fakeChat(string $content, ?string $url = null): void
    {
        Http::fake([$url ?? $this->baseUrl.'/chat/completions' => Http::response([
            'choices' => [['message' => ['content' => $content]]],
        ], 200)]);
    }
}
