<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReportCsvTest extends TestCase
{
    use RefreshDatabase;

    private function adminToken(): string
    {
        return User::factory()->create(['role' => 'admin'])->createToken('test')->plainTextToken;
    }

    public function test_each_report_exports_csv_instead_of_the_json_summary(): void
    {
        $headers = [
            'collections' => 'payment_number,invoice_number,patient_number,amount,method,paid_at',
            'appointments' => 'appointment_number,patient_number,doctor,date,status',
            'patients' => 'patient_number,first_name,last_name,phone,sex,created_at',
            'doctor-consultations' => 'visit_number,patient_number,doctor,date,diagnosis',
        ];
        $token = $this->adminToken();

        foreach ($headers as $report => $header) {
            $response = $this->withToken($token)->get("/api/v1/reports/{$report}?from=2026-10-01&to=2026-10-31&format=csv");

            $response->assertOk();
            $this->assertStringStartsWith('text/csv', (string) $response->headers->get('content-type'));
            $this->assertStringContainsString("{$report}.csv", (string) $response->headers->get('content-disposition'));
            $this->assertStringContainsString($header, $response->streamedContent());
        }
    }

    public function test_reports_still_return_json_without_the_csv_format(): void
    {
        $token = $this->adminToken();

        $this->withToken($token)->getJson('/api/v1/reports/appointments?from=2026-10-01&to=2026-10-31')
            ->assertOk()
            ->assertJsonStructure(['data']);
    }

    public function test_an_unsupported_report_with_csv_returns_not_found(): void
    {
        $this->withToken($this->adminToken())
            ->get('/api/v1/reports/unknown?format=csv')
            ->assertNotFound();
    }

    public function test_csv_export_is_admin_only(): void
    {
        $receptionist = User::factory()->create(['role' => 'receptionist']);

        $this->withToken($receptionist->createToken('test')->plainTextToken)
            ->get('/api/v1/reports/patients?format=csv')
            ->assertForbidden();
    }
}
