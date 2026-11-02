<?php

namespace Tests\Feature;

use App\Models\ClinicSetting;
use App\Models\Doctor;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\User;
use App\Models\Visit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ClinicLogoTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function adminToken(): string
    {
        return User::factory()->create(['role' => 'admin'])->createToken('test')->plainTextToken;
    }

    public function test_an_administrator_uploads_the_clinic_logo(): void
    {
        $token = $this->adminToken();

        $response = $this->withToken($token)
            ->post('/api/v1/settings/clinic/logo', ['logo' => UploadedFile::fake()->image('logo.png', 200, 200)])
            ->assertOk();

        $path = $response->json('data.logo_path');
        $this->assertNotNull($path);
        Storage::disk('local')->assertExists($path);

        $this->withToken($token)
            ->get('/api/v1/settings/clinic/logo')
            ->assertOk()
            ->assertHeader('content-type', 'image/png');
    }

    public function test_uploading_a_new_logo_removes_the_previous_file(): void
    {
        $token = $this->adminToken();
        $first = $this->withToken($token)
            ->post('/api/v1/settings/clinic/logo', ['logo' => UploadedFile::fake()->image('first.png')])
            ->json('data.logo_path');

        $second = $this->withToken($token)
            ->post('/api/v1/settings/clinic/logo', ['logo' => UploadedFile::fake()->image('second.png')])
            ->json('data.logo_path');

        $this->assertNotSame($first, $second);
        Storage::disk('local')->assertMissing($first);
        Storage::disk('local')->assertExists($second);
    }

    public function test_only_administrators_may_change_the_logo(): void
    {
        foreach (['doctor', 'receptionist'] as $role) {
            $token = User::factory()->create(['role' => $role])->createToken('test')->plainTextToken;
            $this->withToken($token)
                ->post('/api/v1/settings/clinic/logo', ['logo' => UploadedFile::fake()->image('logo.png')])
                ->assertForbidden();
            $this->withToken($token)
                ->delete('/api/v1/settings/clinic/logo')
                ->assertForbidden();
        }
    }

    public function test_a_non_image_upload_is_rejected(): void
    {
        $this->withToken($this->adminToken())
            ->post('/api/v1/settings/clinic/logo', ['logo' => UploadedFile::fake()->create('notes.txt', 10, 'text/plain')])
            ->assertUnprocessable();
    }

    public function test_an_administrator_removes_the_logo(): void
    {
        $token = $this->adminToken();
        $path = $this->withToken($token)
            ->post('/api/v1/settings/clinic/logo', ['logo' => UploadedFile::fake()->image('logo.png')])
            ->json('data.logo_path');

        $this->withToken($token)
            ->delete('/api/v1/settings/clinic/logo')
            ->assertOk()
            ->assertJsonPath('data.logo_path', null);

        Storage::disk('local')->assertMissing($path);
        $this->withToken($token)->get('/api/v1/settings/clinic/logo')->assertNotFound();
    }

    public function test_the_receipt_payload_carries_the_logo_for_printing(): void
    {
        $token = $this->adminToken();
        $admin = User::query()->where('email', '!=', '')->first() ?? User::factory()->create(['role' => 'admin']);
        $patient = Patient::create([
            'patient_number' => 'PAT-LOGO-1', 'first_name' => 'Asha', 'phone' => '9000011111',
            'created_by' => $admin->id,
        ]);
        $invoice = Invoice::create([
            'invoice_number' => 'INV-LOGO-1', 'patient_id' => $patient->id, 'invoice_date' => now(),
            'subtotal' => 100, 'discount_amount' => 0, 'total_amount' => 100, 'status' => 'unpaid',
            'created_by' => $admin->id,
        ]);

        $this->withToken($token)
            ->post('/api/v1/settings/clinic/logo', ['logo' => UploadedFile::fake()->image('logo.png')])
            ->assertOk();

        $payload = $this->withToken($token)
            ->getJson("/api/v1/invoices/{$invoice->id}/receipt")
            ->assertOk()
            ->json('data.clinic');

        $this->assertStringStartsWith('data:image/png;base64,', (string) $payload['logo_data_uri']);
    }

    public function test_the_prescription_print_payload_carries_the_logo(): void
    {
        $token = $this->adminToken();
        $admin = User::query()->first() ?? User::factory()->create(['role' => 'admin']);
        $doctorUser = User::factory()->create(['role' => 'doctor']);
        $doctor = Doctor::create(['user_id' => $doctorUser->id, 'display_name' => 'Dr Asha', 'consultation_fee' => 500, 'is_active' => true]);
        $patient = Patient::create([
            'patient_number' => 'PAT-LOGO-3', 'first_name' => 'Nita', 'phone' => '9000033333',
            'created_by' => $admin->id,
        ]);
        $visit = Visit::create([
            'visit_number' => 'VIS-LOGO-1', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id,
            'visit_date' => now(), 'status' => 'finalized', 'created_by' => $admin->id,
        ]);
        $prescription = Prescription::create([
            'prescription_number' => 'RX-LOGO-1', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id,
            'visit_id' => $visit->id, 'issued_at' => now(), 'status' => 'finalized',
        ]);

        $this->withToken($token)
            ->post('/api/v1/settings/clinic/logo', ['logo' => UploadedFile::fake()->image('logo.png')])
            ->assertOk();

        $payload = $this->withToken($token)
            ->getJson("/api/v1/prescriptions/{$prescription->id}/print")
            ->assertOk()
            ->json('data.clinic');

        $this->assertStringStartsWith('data:image/png;base64,', (string) $payload['logo_data_uri']);
    }

    public function test_the_logo_is_public_so_the_sign_in_screen_can_show_it(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $token = $admin->createToken('test')->plainTextToken;

        $this->get('/api/v1/clinic/logo')->assertNotFound();

        $this->withToken($token)
            ->post('/api/v1/settings/clinic/logo', ['logo' => UploadedFile::fake()->image('logo.png')])
            ->assertOk();

        $this->get('/api/v1/clinic/logo')->assertOk()->assertHeader('content-type', 'image/png');

        $status = $this->getJson('/api/v1/setup/status')->assertOk()->json('data');
        $this->assertTrue($status['has_logo']);
        $this->assertNotEmpty($status['clinic_name']);
    }

    public function test_a_receipt_without_a_logo_has_no_inline_image(): void
    {
        $token = $this->adminToken();
        $admin = User::query()->first() ?? User::factory()->create(['role' => 'admin']);
        $patient = Patient::create([
            'patient_number' => 'PAT-LOGO-2', 'first_name' => 'Ravi', 'phone' => '9000022222',
            'created_by' => $admin->id,
        ]);
        $invoice = Invoice::create([
            'invoice_number' => 'INV-LOGO-2', 'patient_id' => $patient->id, 'invoice_date' => now(),
            'subtotal' => 50, 'discount_amount' => 0, 'total_amount' => 50, 'status' => 'unpaid',
            'created_by' => $admin->id,
        ]);

        ClinicSetting::query()->delete();

        $this->withToken($token)
            ->getJson("/api/v1/invoices/{$invoice->id}/receipt")
            ->assertOk()
            ->assertJsonPath('data.clinic', null);
    }
}
