<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClinicListsTest extends TestCase
{
    use RefreshDatabase;

    private function adminToken(): string
    {
        return User::factory()->create(['role' => 'admin'])->createToken('test')->plainTextToken;
    }

    public function test_the_activity_log_paginates_and_filters(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $doctor = User::factory()->create(['role' => 'doctor']);
        $patient = Patient::create(['patient_number' => 'PAT-AUD-1', 'first_name' => 'Asha', 'phone' => '9000011111', 'created_by' => $admin->id]);

        AuditLog::create(['user_id' => $admin->id, 'action' => 'created', 'entity_type' => 'patient', 'entity_id' => $patient->id, 'summary' => 'Registered Asha Verma', 'created_at' => now()->subDay()]);
        AuditLog::create(['user_id' => $doctor->id, 'action' => 'updated', 'entity_type' => 'appointment', 'entity_id' => 7, 'summary' => 'Appointment moved', 'created_at' => now()->subDays(3)]);
        AuditLog::create(['user_id' => $admin->id, 'action' => 'deleted', 'entity_type' => 'patient', 'entity_id' => $patient->id, 'summary' => 'Removed a record', 'created_at' => now()->subDays(5)]);

        $token = $this->adminToken();

        $all = $this->withToken($token)->getJson('/api/v1/audit-logs')->assertOk()->json('data');
        $this->assertSame(3, $all['total']);
        $this->assertSame(20, $all['per_page']);

        $byAction = $this->withToken($token)->getJson('/api/v1/audit-logs?action=updated')->assertOk()->json('data');
        $this->assertSame(1, $byAction['total']);
        $this->assertSame('Appointment moved', $byAction['data'][0]['summary']);

        $byEntity = $this->withToken($token)->getJson('/api/v1/audit-logs?entity_type=patient')->assertOk()->json('data');
        $this->assertSame(2, $byEntity['total']);

        $byUser = $this->withToken($token)->getJson('/api/v1/audit-logs?user_id='.$doctor->id)->assertOk()->json('data');
        $this->assertSame(1, $byUser['total']);

        $bySearch = $this->withToken($token)->getJson('/api/v1/audit-logs?search=Removed')->assertOk()->json('data');
        $this->assertSame(1, $bySearch['total']);

        $byDate = $this->withToken($token)->getJson('/api/v1/audit-logs?date_from='.now()->subDays(2)->toDateString())->assertOk()->json('data');
        $this->assertSame(1, $byDate['total']);

        $paged = $this->withToken($token)->getJson('/api/v1/audit-logs?per_page=1&page=2')->assertOk()->json('data');
        $this->assertSame(1, count($paged['data']));
        $this->assertSame(2, $paged['current_page']);
    }

    public function test_the_activity_log_only_offers_staff_and_real_filter_values(): void
    {
        $token = $this->adminToken();
        AuditLog::create(['user_id' => null, 'action' => 'sent', 'entity_type' => 'whatsapp_message', 'entity_id' => 1, 'summary' => 'Message sent']);

        $options = $this->withToken($token)->getJson('/api/v1/audit-logs/options')->assertOk()->json('data');
        $this->assertContains('sent', $options['actions']);
        $this->assertContains('whatsapp_message', $options['entity_types']);
        foreach ($options['users'] as $user) {
            $this->assertNotSame('patient', $user['role']);
        }
    }

    public function test_the_activity_log_is_admin_only(): void
    {
        $receptionist = User::factory()->create(['role' => 'receptionist']);
        $token = $receptionist->createToken('test')->plainTextToken;

        $this->withToken($token)->getJson('/api/v1/audit-logs')->assertForbidden();
        $this->withToken($token)->getJson('/api/v1/audit-logs/options')->assertForbidden();
    }

    public function test_an_invoice_without_payments_can_be_edited(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $patient = Patient::create(['patient_number' => 'PAT-EDIT-1', 'first_name' => 'Ravi', 'phone' => '9000022222', 'created_by' => $admin->id]);
        $invoice = Invoice::create([
            'invoice_number' => 'INV-EDIT-1', 'patient_id' => $patient->id, 'invoice_date' => now(),
            'subtotal' => 100, 'discount_amount' => 0, 'total_amount' => 100, 'status' => 'unpaid', 'created_by' => $admin->id,
        ]);
        $invoice->items()->create(['description' => 'Consultation', 'quantity' => 1, 'unit_price' => 100, 'line_total' => 100]);

        $token = $admin->createToken('test')->plainTextToken;
        $this->withToken($token)
            ->putJson("/api/v1/invoices/{$invoice->id}", [
                'items' => [
                    ['description' => 'Consultation', 'quantity' => 2, 'unit_price' => 150],
                    ['description' => 'Follow-up', 'quantity' => 1, 'unit_price' => 50],
                ],
                'discount_amount' => 50,
                'notes' => 'Corrected qty',
            ])
            ->assertOk()
            ->assertJsonPath('data.total_amount', '300.00')
            ->assertJsonPath('data.subtotal', '350.00');

        $invoice->refresh();
        $this->assertSame(350.0, (float) $invoice->subtotal);
        $this->assertSame(300.0, (float) $invoice->total_amount);
        $this->assertCount(2, $invoice->items);
    }

    public function test_an_invoice_with_payments_cannot_be_edited(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $patient = Patient::create(['patient_number' => 'PAT-EDIT-2', 'first_name' => 'Nita', 'phone' => '9000033333', 'created_by' => $admin->id]);
        $invoice = Invoice::create([
            'invoice_number' => 'INV-EDIT-2', 'patient_id' => $patient->id, 'invoice_date' => now(),
            'subtotal' => 100, 'discount_amount' => 0, 'total_amount' => 100, 'status' => 'partially_paid', 'created_by' => $admin->id,
        ]);
        $invoice->items()->create(['description' => 'Consultation', 'quantity' => 1, 'unit_price' => 100, 'line_total' => 100]);
        Payment::create([
            'payment_number' => 'RCT-EDIT-2', 'invoice_id' => $invoice->id, 'amount' => 50,
            'payment_method' => 'cash', 'status' => 'completed', 'entry_type' => 'payment',
            'received_by' => $admin->id, 'paid_at' => now(),
        ]);

        $token = $admin->createToken('test')->plainTextToken;
        $this->withToken($token)
            ->putJson("/api/v1/invoices/{$invoice->id}", ['items' => [['description' => 'Consultation', 'quantity' => 3, 'unit_price' => 100]]])
            ->assertUnprocessable();

        $this->assertSame(1, (int) $invoice->items()->count());
    }

    public function test_an_invoice_keeps_a_deleted_patient_for_reference(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $patient = Patient::create(['patient_number' => 'PAT-DEL-1', 'first_name' => 'Ravi', 'phone' => '9000055555', 'created_by' => $admin->id]);
        $invoice = Invoice::create([
            'invoice_number' => 'INV-DEL-1', 'patient_id' => $patient->id, 'invoice_date' => now(),
            'subtotal' => 100, 'discount_amount' => 0, 'total_amount' => 100, 'status' => 'unpaid', 'created_by' => $admin->id,
        ]);
        $patient->delete();

        $token = $admin->createToken('test')->plainTextToken;
        $shown = $this->withToken($token)->getJson("/api/v1/invoices/{$invoice->id}")->assertOk()->json('data');
        $this->assertSame('Ravi', $shown['patient']['first_name']);
        $this->assertNotNull($shown['patient']['deleted_at']);

        $list = $this->withToken($token)->getJson('/api/v1/invoices')->assertOk()->json('data.data');
        $this->assertSame('Ravi', $list[0]['patient']['first_name']);
    }

    public function test_only_administrators_can_edit_an_invoice(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $patient = Patient::create(['patient_number' => 'PAT-EDIT-3', 'first_name' => 'Omkar', 'phone' => '9000044444', 'created_by' => $admin->id]);
        $invoice = Invoice::create([
            'invoice_number' => 'INV-EDIT-3', 'patient_id' => $patient->id, 'invoice_date' => now(),
            'subtotal' => 100, 'discount_amount' => 0, 'total_amount' => 100, 'status' => 'unpaid', 'created_by' => $admin->id,
        ]);

        $receptionist = User::factory()->create(['role' => 'receptionist']);
        $token = $receptionist->createToken('test')->plainTextToken;
        $this->withToken($token)
            ->putJson("/api/v1/invoices/{$invoice->id}", ['items' => [['description' => 'Consultation', 'quantity' => 1, 'unit_price' => 100]]])
            ->assertForbidden();
    }
}
