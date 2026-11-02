<?php

namespace Tests\Feature;

use App\Models\Patient;
use App\Models\User;
use App\Models\WhatsAppConnection;
use App\Models\WhatsAppMetaTemplate;
use App\Models\WhatsAppTemplate;
use App\Support\WhatsAppDispatcher;
use App\Support\WhatsAppTemplateSync;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class WhatsAppTemplateSyncTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'whatsapp.business_account_id' => '100',
            'whatsapp.access_token' => 'test-token',
            'whatsapp.graph_version' => 'v26.0',
            'whatsapp.api_base' => 'https://graph.facebook.com',
            'whatsapp.enabled' => true,
            'whatsapp.log_only' => false,
        ]);
        Http::preventStrayRequests();
        $this->actingAs(User::factory()->create(['role' => 'admin']));
    }

    /** @param array<string,mixed> $callbacks */
    private function fakeHttp(array $callbacks): void
    {
        Http::swap(new Factory);
        Http::preventStrayRequests();
        Http::fake($callbacks);
    }

    /** @return array<string,mixed> */
    private function remote(int $id, string $body, string $status = 'APPROVED', string $name = 'clinic_reminder', string $language = 'en'): array
    {
        preg_match_all('/\{\{([a-z0-9_]+)\}\}/i', $body, $matches);

        return [
            'id' => (string) $id,
            'name' => $name,
            'language' => $language,
            'category' => 'UTILITY',
            'status' => $status,
            'parameter_format' => 'POSITIONAL',
            'components' => [
                ['type' => 'BODY', 'text' => $body, 'example' => ['body_text' => [['Asha', '21 Oct 2026']]]],
                ['type' => 'FOOTER', 'text' => 'Carehaven Clinic'],
            ],
        ];
    }

    private function fakeCatalog(array $rows): void
    {
        $this->fakeHttp([
            '*/100/message_templates*' => function ($request) use ($rows) {
                if (str_contains($request->url(), 'after=')) {
                    return Http::response(['data' => array_slice($rows, 1), 'paging' => []]);
                }

                return Http::response([
                    'data' => [array_slice($rows, 0, 1)[0]],
                    'paging' => ['next' => 'https://graph.facebook.com/v26.0/100/message_templates?after=cursor'],
                ]);
            },
        ]);
    }

    private function local(string $event = 'appointment_reminder'): WhatsAppTemplate
    {
        return app(WhatsAppDispatcher::class)->template($event);
    }

    public function test_pull_imports_every_page_and_keeps_unlinked_templates_as_catalog(): void
    {
        $this->fakeCatalog([
            $this->remote(9001, 'Hello {{1}}, your visit is on {{2}}.'),
            $this->remote(9002, 'Your prescription is ready.', 'PENDING', 'clinic_prescription'),
        ]);

        $this->postJson('/api/v1/whatsapp/meta-templates/pull')
            ->assertOk()
            ->assertJsonPath('data.imported', 2);

        $this->assertDatabaseHas('whatsapp_meta_templates', ['meta_template_id' => '9002', 'status' => 'PENDING', 'missing' => false]);
        $this->assertSame(['1', '2'], WhatsAppMetaTemplate::where('meta_template_id', '9001')->first()->placeholders);
        $this->getJson('/api/v1/whatsapp/meta-templates')
            ->assertOk()
            ->assertJsonPath('data.configured', true)
            ->assertJsonCount(2, 'data.templates');
    }

    public function test_failed_page_keeps_the_previous_catalog_without_missing_flags(): void
    {
        $this->fakeCatalog([$this->remote(9001, 'Hello {{1}}.'), $this->remote(9002, 'Second.')]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();

        $this->fakeHttp([
            '*/100/message_templates*' => fn ($request) => str_contains($request->url(), 'after=')
                ? Http::response(['error' => ['message' => 'boom']], 500)
                : Http::response(['data' => [$this->remote(9001, 'Changed {{1}}.')], 'paging' => ['next' => 'https://graph.facebook.com/v26.0/100/message_templates?after=cursor']]),
        ]);

        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertStatus(502);
        $this->assertSame(0, WhatsAppMetaTemplate::where('missing', true)->count());
        $this->assertSame(2, WhatsAppMetaTemplate::count());
        $this->assertSame('Hello {{1}}.', WhatsAppMetaTemplate::where('meta_template_id', '9001')->value('body'));
    }

    public function test_adopt_maps_parameters_and_rewrites_local_placeholders(): void
    {
        $this->fakeCatalog([$this->remote(9001, 'Hello {{1}}, see {{2}} on {{3}}.')]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();
        $catalogId = WhatsAppMetaTemplate::where('meta_template_id', '9001')->value('id');
        $local = $this->local();

        $response = $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/adopt', [
            'meta_template_id' => $catalogId,
            'expected_revision' => $local->revision,
            'bindings' => ['1' => 'patient_name', '2' => 'doctor_name', '3' => 'appointment_time'],
        ])->assertOk();

        $response->assertJsonPath('data.sync_state', 'synced')
            ->assertJsonPath('data.meta_status', 'APPROVED')
            ->assertJsonPath('data.body', 'Hello {{patient_name}}, see {{doctor_name}} on {{appointment_time}}.');

        $this->assertDatabaseHas('whatsapp_templates', [
            'event' => 'appointment_reminder',
            'template_name' => 'clinic_reminder',
            'meta_template_id' => '9001',
        ]);
    }

    public function test_adopt_requires_a_variable_for_every_meta_parameter(): void
    {
        $this->fakeCatalog([$this->remote(9001, 'Hello {{1}} and {{2}}.')]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();
        $catalogId = WhatsAppMetaTemplate::where('meta_template_id', '9001')->value('id');

        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/adopt', [
            'meta_template_id' => $catalogId,
            'expected_revision' => $this->local()->revision,
            'bindings' => ['1' => 'patient_name', '2' => 'not_a_real_variable'],
        ])->assertUnprocessable();
    }

    public function test_a_stale_revision_cannot_overwrite_a_concurrent_draft(): void
    {
        $local = $this->local();
        $this->putJson('/api/v1/whatsapp/templates/appointment_reminder', [
            'template_name' => $local->template_name,
            'body' => 'Hello {{patient_name}}, updated.',
            'expected_revision' => $local->revision,
        ])->assertOk();

        $this->putJson('/api/v1/whatsapp/templates/appointment_reminder', [
            'template_name' => $local->template_name,
            'body' => 'Stale overwrite.',
            'expected_revision' => $local->revision,
        ])->assertStatus(409);

        $this->assertSame('Hello {{patient_name}}, updated.', WhatsAppTemplate::where('event', 'appointment_reminder')->value('body'));
    }

    public function test_remote_change_imports_when_the_local_draft_is_unchanged(): void
    {
        $this->fakeCatalog([$this->remote(9001, 'Hello {{1}}, see you on {{2}}.')]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();
        $catalogId = WhatsAppMetaTemplate::where('meta_template_id', '9001')->value('id');
        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/adopt', [
            'meta_template_id' => $catalogId,
            'expected_revision' => $this->local()->revision,
            'bindings' => ['1' => 'patient_name', '2' => 'appointment_date'],
        ])->assertOk();

        $this->fakeCatalog([$this->remote(9001, 'Hello {{1}}, your visit is on {{2}}.')]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk()->assertJsonPath('data.updated', 1);

        $this->assertSame(
            'Hello {{patient_name}}, your visit is on {{appointment_date}}.',
            WhatsAppTemplate::where('event', 'appointment_reminder')->value('body'),
        );
    }

    public function test_remote_and_local_changes_produce_a_conflict_and_preserve_both(): void
    {
        $this->fakeCatalog([$this->remote(9001, 'Hello {{1}}, see you on {{2}}.')]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();
        $catalogId = WhatsAppMetaTemplate::where('meta_template_id', '9001')->value('id');
        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/adopt', [
            'meta_template_id' => $catalogId,
            'expected_revision' => $this->local()->revision,
            'bindings' => ['1' => 'patient_name', '2' => 'appointment_date'],
        ])->assertOk();

        $local = $this->local();
        $this->putJson('/api/v1/whatsapp/templates/appointment_reminder', [
            'template_name' => $local->template_name,
            'body' => 'Clinic wording for {{patient_name}} on {{appointment_date}}.',
            'expected_revision' => $local->revision,
        ])->assertOk();

        $this->fakeCatalog([$this->remote(9001, 'Meta wording {{1}} on {{2}}.')]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk()->assertJsonPath('data.conflicts', 1);

        $local = WhatsAppTemplate::where('event', 'appointment_reminder')->first();
        $this->assertSame('conflict', $local->sync_state);
        $this->assertSame('Clinic wording for {{patient_name}} on {{appointment_date}}.', $local->body);
        $this->assertSame('Meta wording {{1}} on {{2}}.', WhatsAppMetaTemplate::where('meta_template_id', '9001')->value('body'));

        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/publish', [
            'expected_revision' => $local->revision,
        ])->assertStatus(409);
    }

    public function test_publishing_a_new_template_creates_it_and_never_claims_approval(): void
    {
        $local = $this->local();
        $local->forceFill([
            'template_name' => 'clinic_appointment_reminder',
            'body' => 'Hi {{patient_name}}, see you on {{appointment_date}}.',
        ])->save();
        $sent = null;

        $this->fakeHttp([
            '*/100/message_templates' => function ($request) use (&$sent) {
                $sent = $request->data();

                return Http::response(['id' => '9001']);
            },
            '*/9001*' => function () use (&$sent) {
                return Http::response([
                    'id' => '9001', 'name' => $sent['name'], 'language' => $sent['language'],
                    'category' => $sent['category'], 'status' => 'PENDING',
                    'parameter_format' => 'POSITIONAL', 'components' => $sent['components'],
                ]);
            },
        ]);

        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/publish', [
            'expected_revision' => $local->revision,
        ])->assertOk()
            ->assertJsonPath('data.confirmed', true)
            ->assertJsonPath('data.template.sync_state', 'pending')
            ->assertJsonPath('data.template.meta_status', 'PENDING');

        $this->assertSame('Hi {{1}}, see you on {{2}}.', $sent['components'][0]['text']);
        $this->assertSame('UTILITY', $sent['category']);
        $this->assertDatabaseHas('whatsapp_templates', ['event' => 'appointment_reminder', 'meta_template_id' => '9001', 'sync_state' => 'pending']);
    }

    public function test_publishing_an_edit_preserves_other_components_and_rejects_stale_remote_content(): void
    {
        $this->fakeCatalog([$this->remote(9001, 'Hello {{1}}.')]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();
        $catalogId = WhatsAppMetaTemplate::where('meta_template_id', '9001')->value('id');
        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/adopt', [
            'meta_template_id' => $catalogId,
            'expected_revision' => $this->local()->revision,
            'bindings' => ['1' => 'patient_name'],
        ])->assertOk();

        $local = $this->local();
        $this->putJson('/api/v1/whatsapp/templates/appointment_reminder', [
            'template_name' => $local->template_name,
            'body' => 'Hello {{patient_name}}, this is a reminder.',
            'expected_revision' => $local->revision,
        ])->assertOk();

        $sent = null;
        $this->fakeHttp([
            '*/9001*' => function ($request) use (&$sent) {
                if ($request->method() === 'GET') {
                    return Http::response($this->remote(9001, 'Hello {{1}} and more.'));
                }
                $sent = $request->data();

                return Http::response(['success' => true]);
            },
        ]);

        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/publish', [
            'expected_revision' => $local->fresh()->revision,
        ])->assertStatus(409);
        $this->assertNull($sent);
    }

    public function test_publish_edit_keeps_footer_and_does_not_rename_a_template(): void
    {
        $this->fakeCatalog([$this->remote(9001, 'Hello {{1}}.')]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();
        $catalogId = WhatsAppMetaTemplate::where('meta_template_id', '9001')->value('id');
        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/adopt', [
            'meta_template_id' => $catalogId,
            'expected_revision' => $this->local()->revision,
            'bindings' => ['1' => 'patient_name'],
        ])->assertOk();

        $local = $this->local();
        $this->putJson('/api/v1/whatsapp/templates/appointment_reminder', [
            'template_name' => $local->template_name,
            'body' => 'Hello {{patient_name}}, updated reminder.',
            'expected_revision' => $local->revision,
        ])->assertOk();
        $local = $this->local();

        $this->putJson('/api/v1/whatsapp/templates/appointment_reminder', [
            'template_name' => 'another_name',
            'body' => $local->body,
            'expected_revision' => $local->revision,
        ])->assertOk();
        $renamed = $this->local();

        $this->fakeHttp(['*/9001*' => Http::response($this->remote(9001, 'Hello {{1}}.'))]);
        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/publish', [
            'expected_revision' => $renamed->revision,
        ])->assertStatus(409);
    }

    public function test_live_send_requires_an_approved_template_and_matching_wording(): void
    {
        $this->fakeCatalog([$this->remote(9001, 'Hello {{1}}, see you on {{2}}.')]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();
        $catalogId = WhatsAppMetaTemplate::where('meta_template_id', '9001')->value('id');
        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/adopt', [
            'meta_template_id' => $catalogId,
            'expected_revision' => $this->local()->revision,
            'bindings' => ['1' => 'patient_name', '2' => 'appointment_date'],
        ])->assertOk();

        $outbound = app(WhatsAppTemplateSync::class)->outbound($this->local(), [
            'patient_name' => 'Asha', 'appointment_date' => '21 Oct 2026',
        ]);
        $this->assertSame('clinic_reminder', $outbound['name']);
        $this->assertSame('en', $outbound['language']);
        $this->assertSame(['Asha', '21 Oct 2026'], $outbound['parameters']);

        $local = $this->local();
        $local->forceFill(['body' => 'Edited wording for {{patient_name}} on {{appointment_date}}.'])->save();

        $this->expectExceptionMessage('no longer matches');
        app(WhatsAppTemplateSync::class)->outbound($local, ['patient_name' => 'Asha', 'appointment_date' => '21 Oct 2026']);
    }

    public function test_live_send_blocks_a_pending_or_missing_template(): void
    {
        $this->fakeCatalog([$this->remote(9001, 'Hello {{1}}.', 'PENDING')]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();
        $catalogId = WhatsAppMetaTemplate::where('meta_template_id', '9001')->value('id');
        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/adopt', [
            'meta_template_id' => $catalogId,
            'expected_revision' => $this->local()->revision,
            'bindings' => ['1' => 'patient_name'],
        ])->assertOk();

        $this->expectExceptionMessage('not approved');
        app(WhatsAppTemplateSync::class)->outbound($this->local(), ['patient_name' => 'Asha']);
    }

    public function test_a_timed_out_publish_is_reconciled_by_the_next_pull(): void
    {
        $local = $this->local();
        $local->forceFill([
            'template_name' => 'clinic_appointment_reminder',
            'body' => 'Hi {{patient_name}}, see you soon.',
        ])->save();
        $sent = null;

        $this->fakeHttp([
            '*/100/message_templates' => function ($request) use (&$sent) {
                $sent = $request->data();
                throw new ConnectionException('timeout');
            },
        ]);

        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/publish', [
            'expected_revision' => $local->revision,
        ])->assertStatus(502);

        $this->assertSame('uncertain', $this->local()->sync_state);
        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/publish', [
            'expected_revision' => $this->local()->revision,
        ])->assertStatus(409);

        $remote = $this->remote(9001, 'Hi {{1}}, see you soon.', 'PENDING', 'clinic_appointment_reminder');
        $remote['components'] = $sent['components'];
        $this->fakeCatalog([$remote]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk()->assertJsonPath('data.updated', 1);

        $local = $this->local();
        $this->assertSame('9001', $local->meta_template_id);
        $this->assertSame('pending', $local->sync_state);
        $this->assertNull($local->pending_hash);
    }

    public function test_an_administrator_can_explicitly_keep_clinic_wording_after_a_conflict(): void
    {
        $this->fakeCatalog([$this->remote(9001, 'Hello {{1}}, see you on {{2}}.')]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();
        $catalogId = WhatsAppMetaTemplate::where('meta_template_id', '9001')->value('id');
        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/adopt', [
            'meta_template_id' => $catalogId,
            'expected_revision' => $this->local()->revision,
            'bindings' => ['1' => 'patient_name', '2' => 'appointment_date'],
        ])->assertOk();

        $local = $this->local();
        $this->putJson('/api/v1/whatsapp/templates/appointment_reminder', [
            'template_name' => $local->template_name,
            'body' => 'Clinic wording {{patient_name}} on {{appointment_date}}.',
            'expected_revision' => $local->revision,
        ])->assertOk();

        $this->fakeCatalog([$this->remote(9001, 'Meta wording {{1}} on {{2}}.')]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();
        $local = $this->local();
        $this->assertSame('conflict', $local->sync_state);

        $sent = null;
        $posted = false;
        $remoteNow = $this->remote(9001, 'Meta wording {{1}} on {{2}}.');
        $this->fakeHttp([
            'https://graph.facebook.com/v26.0/9001*' => function ($request) use (&$sent, &$posted, $remoteNow) {
                if ($request->method() === 'GET') {
                    if ($posted) {
                        $remoteNow['components'][0]['text'] = 'Clinic wording {{1}} on {{2}}.';
                    }

                    return Http::response($remoteNow);
                }
                $posted = true;
                $sent = $request->data();

                return Http::response(['success' => true]);
            },
        ]);

        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/publish', [
            'expected_revision' => $local->revision,
            'resolve' => 'keep_local',
        ])->assertOk();

        $this->assertSame('Clinic wording {{1}} on {{2}}.', $sent['components'][0]['text']);
    }

    public function test_sync_endpoints_are_admin_only(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'receptionist']));
        $this->getJson('/api/v1/whatsapp/meta-templates')->assertForbidden();
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertForbidden();
        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/adopt')->assertForbidden();
        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/publish')->assertForbidden();
        Http::assertNothingSent();
    }

    public function test_sync_uses_the_standard_account_when_coexistence_is_not_connected(): void
    {
        WhatsAppConnection::create([
            'id' => 1, 'waba_id' => '100', 'phone_number_id' => '777',
            'display_phone_number' => '+919876543210', 'token' => 'old-token',
            'status' => 'disconnected', 'connected_at' => now(),
        ]);

        $credentials = app(WhatsAppTemplateSync::class)->credentials();
        $this->assertSame(['waba_id' => '100', 'token' => 'test-token'], $credentials);

        $this->fakeCatalog([$this->remote(9001, 'Hello {{1}}.')]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();
        $this->assertSame(1, DB::table('whatsapp_meta_templates')->count());
    }

    public function test_a_template_with_a_photo_header_and_buttons_is_imported(): void
    {
        $row = $this->remote(9001, 'Hello {{1}}, your report is attached.');
        $row['components'] = [
            ['type' => 'HEADER', 'format' => 'IMAGE', 'example' => ['header_handle' => ['https://example.com/report.png']]],
            ['type' => 'BODY', 'text' => 'Hello {{1}}, your report is attached.', 'example' => ['body_text' => [['Asha']]]],
            ['type' => 'BUTTONS', 'buttons' => [
                ['type' => 'QUICK_REPLY', 'text' => 'Yes'],
                ['type' => 'URL', 'text' => 'View report', 'url' => 'https://example.com/report/{{1}}'],
            ]],
        ];
        $this->fakeCatalog([$row]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();

        $catalog = WhatsAppMetaTemplate::where('meta_template_id', '9001')->first();
        $this->assertTrue($catalog->supported);
        $this->assertSame('IMAGE', $catalog->header_type);
        $this->assertSame('https://example.com/report.png', $catalog->header_example);
        $this->assertCount(2, $catalog->button_summary);
        $this->assertSame(1, $catalog->button_parameter_count);

        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/adopt', [
            'meta_template_id' => $catalog->id,
            'expected_revision' => $this->local()->revision,
            'bindings' => ['1' => 'patient_name'],
        ])->assertOk()->assertJsonPath('data.header_type', 'IMAGE');
    }

    public function test_a_photo_template_needs_a_public_media_link_before_it_can_be_sent(): void
    {
        $row = $this->remote(9001, 'Hello {{1}}.');
        $row['components'][] = ['type' => 'HEADER', 'format' => 'IMAGE', 'example' => ['header_handle' => ['https://example.com/report.png']]];
        $this->fakeCatalog([$row]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();
        $catalog = WhatsAppMetaTemplate::where('meta_template_id', '9001')->first();

        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/adopt', [
            'meta_template_id' => $catalog->id,
            'expected_revision' => $this->local()->revision,
            'bindings' => ['1' => 'patient_name'],
        ])->assertOk();

        $local = $this->local();
        $this->assertSame(0, (int) $catalog->button_parameter_count);

        try {
            app(WhatsAppTemplateSync::class)->outbound($local, ['patient_name' => 'Asha']);
            $this->fail('A media template must not be sent without a public media link.');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('media link', $e->getMessage());
        }

        $local->update(['media_url' => 'https://example.com/report.png']);
        $outbound = app(WhatsAppTemplateSync::class)->outbound($local->fresh(), ['patient_name' => 'Asha']);
        $this->assertSame(['type' => 'image', 'link' => 'https://example.com/report.png'], $outbound['header']);
    }

    public function test_a_button_that_needs_a_value_is_not_sent_automatically(): void
    {
        $row = $this->remote(9001, 'Hello {{1}}.');
        $row['components'][] = ['type' => 'BUTTONS', 'buttons' => [
            ['type' => 'URL', 'text' => 'Track', 'url' => 'https://example.com/{{1}}'],
        ]];
        $this->fakeCatalog([$row]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();
        $catalog = WhatsAppMetaTemplate::where('meta_template_id', '9001')->first();
        $this->assertTrue($catalog->supported);
        $this->assertSame(1, $catalog->button_parameter_count);

        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/adopt', [
            'meta_template_id' => $catalog->id,
            'expected_revision' => $this->local()->revision,
            'bindings' => ['1' => 'patient_name'],
        ])->assertOk();

        $this->expectExceptionMessage('button that needs a value');
        app(WhatsAppTemplateSync::class)->outbound($this->local()->fresh(), ['patient_name' => 'Asha']);
    }

    public function test_a_photo_template_sends_its_header_with_the_message(): void
    {
        $row = $this->remote(9001, 'Hello {{1}}.');
        $row['components'][] = ['type' => 'HEADER', 'format' => 'IMAGE', 'example' => ['header_handle' => ['https://example.com/report.png']]];
        $this->fakeCatalog([$row]);
        $this->postJson('/api/v1/whatsapp/meta-templates/pull')->assertOk();
        $catalog = WhatsAppMetaTemplate::where('meta_template_id', '9001')->first();

        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/adopt', [
            'meta_template_id' => $catalog->id,
            'expected_revision' => $this->local()->revision,
            'bindings' => ['1' => 'patient_name'],
        ])->assertOk();

        $this->local()->update(['media_url' => 'https://example.com/report.png']);
        config(['whatsapp.enabled' => true, 'whatsapp.log_only' => false, 'whatsapp.phone_number_id' => '100']);
        Http::fake(['*/100/messages' => Http::response(['messages' => [['id' => 'wamid.media']]], 200)]);

        $patient = Patient::create([
            'patient_number' => 'PAT-MEDIA-1', 'first_name' => 'Asha', 'phone' => '9876543210',
            'whatsapp_opt_in' => true, 'created_by' => User::factory()->create(['role' => 'admin'])->id,
        ]);

        $result = app(WhatsAppDispatcher::class)->send(
            $patient,
            'appointment_reminder',
            ['patient_name' => 'Asha'],
        );

        $this->assertSame('sent', $result['status'], (string) $result['error']);
        Http::assertSent(function ($request) {
            $components = $request->data()['template']['components'] ?? [];

            return ($components[0]['type'] ?? null) === 'header'
                && ($components[0]['parameters'][0]['image']['link'] ?? null) === 'https://example.com/report.png'
                && ($components[1]['type'] ?? null) === 'body';
        });
    }

    public function test_a_new_template_can_be_published_with_a_media_header(): void
    {
        $sent = null;
        Http::fake([
            '*/100/message_templates' => function ($request) use (&$sent) {
                $sent = $request->data();

                return Http::response(['id' => '9001']);
            },
            '*/9001*' => function () use (&$sent) {
                return Http::response([
                    'id' => '9001', 'name' => $sent['name'], 'language' => $sent['language'],
                    'category' => $sent['category'], 'status' => 'PENDING',
                    'parameter_format' => 'POSITIONAL', 'components' => $sent['components'],
                ]);
            },
        ]);

        $local = $this->local();
        $local->forceFill([
            'template_name' => 'clinic_appointment_reminder',
            'body' => 'Hi {{patient_name}}, your report is attached.',
        ])->save();

        $this->postJson('/api/v1/whatsapp/templates/appointment_reminder/publish', [
            'expected_revision' => $local->revision,
            'header' => ['type' => 'IMAGE', 'sample' => 'https://example.com/report.png'],
        ])->assertOk()->assertJsonPath('data.confirmed', true);

        $this->assertSame('IMAGE', $sent['components'][0]['format']);
        $this->assertSame(['https://example.com/report.png'], $sent['components'][0]['example']['header_handle']);
        $this->assertSame('Hi {{1}}, your report is attached.', $sent['components'][1]['text']);
    }
}
