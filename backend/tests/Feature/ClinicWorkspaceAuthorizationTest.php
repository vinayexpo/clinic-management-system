<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Doctor;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\User;
use App\Models\Visit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClinicWorkspaceAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $role): User
    {
        return User::factory()->create(['role' => $role]);
    }

    private function token(User $user): string
    {
        return $user->createToken('test')->plainTextToken;
    }

    private function asUser(User $user): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($this->token($user));
    }

    public function test_patient_cannot_read_staff_appointment_and_clinical_lists(): void
    {
        $patientUser = $this->user('patient');

        $this->asUser($patientUser)->getJson('/api/v1/appointments')->assertForbidden();
        $this->asUser($patientUser)->getJson('/api/v1/visits')->assertForbidden();
        $this->asUser($patientUser)->getJson('/api/v1/prescriptions')->assertForbidden();
        $this->asUser($patientUser)->getJson('/api/v1/invoices')->assertForbidden();
        $this->asUser($patientUser)->getJson('/api/v1/reports/collections')->assertForbidden();
    }

    public function test_doctor_prescription_list_is_paginated_and_scoped_to_the_doctor(): void
    {
        $admin = $this->user('admin');
        $doctorUser = $this->user('doctor');
        $otherDoctorUser = $this->user('doctor');
        $doctor = Doctor::create(['user_id' => $doctorUser->id, 'display_name' => 'Dr One', 'consultation_fee' => 500, 'is_active' => true]);
        $otherDoctor = Doctor::create(['user_id' => $otherDoctorUser->id, 'display_name' => 'Dr Two', 'consultation_fee' => 500, 'is_active' => true]);
        $patient = Patient::create(['patient_number' => 'PAT-RX-1', 'first_name' => 'Asha', 'phone' => '9000010001', 'created_by' => $admin->id]);
        $visit = Visit::create(['visit_number' => 'VIS-RX-1', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'visit_date' => today(), 'status' => 'finalized', 'created_by' => $admin->id]);
        $otherVisit = Visit::create(['visit_number' => 'VIS-RX-2', 'patient_id' => $patient->id, 'doctor_id' => $otherDoctor->id, 'visit_date' => today(), 'status' => 'finalized', 'created_by' => $admin->id]);
        Prescription::create(['prescription_number' => 'RX-1', 'visit_id' => $visit->id, 'patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'status' => 'draft']);
        $otherPrescription = Prescription::create(['prescription_number' => 'RX-2', 'visit_id' => $otherVisit->id, 'patient_id' => $patient->id, 'doctor_id' => $otherDoctor->id, 'status' => 'draft']);

        $this->asUser($doctorUser)->getJson('/api/v1/prescriptions?per_page=1&status=draft')
            ->assertOk()->assertJsonPath('data.total', 1)->assertJsonCount(1, 'data.data')->assertJsonPath('data.data.0.prescription_number', 'RX-1');
        $this->asUser($doctorUser)->getJson("/api/v1/prescriptions/{$otherPrescription->id}")->assertForbidden();
    }

    public function test_receptionist_cannot_read_clinical_visit_or_prescription_lists(): void
    {
        $receptionist = $this->user('receptionist');

        $this->asUser($receptionist)->getJson('/api/v1/visits')->assertForbidden();
        $this->asUser($receptionist)->getJson('/api/v1/prescriptions')->assertForbidden();
    }

    public function test_doctor_appointment_list_and_status_are_limited_to_assigned_records(): void
    {
        $admin = $this->user('admin');
        $doctorUser = $this->user('doctor');
        $otherDoctorUser = $this->user('doctor');
        $doctor = Doctor::create(['user_id' => $doctorUser->id, 'display_name' => 'Dr Assigned', 'consultation_fee' => 0, 'is_active' => true]);
        $otherDoctor = Doctor::create(['user_id' => $otherDoctorUser->id, 'display_name' => 'Dr Other', 'consultation_fee' => 0, 'is_active' => true]);
        $patient = Patient::create(['patient_number' => 'PAT-APT-1', 'first_name' => 'Amar', 'phone' => '9000010010', 'created_by' => $admin->id]);
        $own = Appointment::create(['appointment_number' => 'APT-OWN', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id, 'appointment_date' => today(), 'start_time' => '09:00', 'visit_type' => 'appointment', 'status' => 'waiting', 'token_number' => 1, 'created_by' => $admin->id]);
        $other = Appointment::create(['appointment_number' => 'APT-OTHER', 'patient_id' => $patient->id, 'doctor_id' => $otherDoctor->id, 'appointment_date' => today(), 'start_time' => '10:00', 'visit_type' => 'appointment', 'status' => 'waiting', 'token_number' => 2, 'created_by' => $admin->id]);

        $this->asUser($doctorUser)->getJson('/api/v1/appointments?date=all&per_page=20')
            ->assertOk()->assertJsonPath('data.total', 1)->assertJsonPath('data.data.0.appointment_number', 'APT-OWN');
        $this->asUser($doctorUser)->getJson("/api/v1/appointments/{$other->id}")->assertForbidden();
        $this->asUser($doctorUser)->postJson("/api/v1/appointments/{$other->id}/status", ['status' => 'in_consultation'])->assertForbidden();
        $this->asUser($doctorUser)->postJson("/api/v1/appointments/{$own->id}/status", ['status' => 'in_consultation'])->assertOk();
    }

    public function test_only_admin_can_void_an_unpaid_invoice_and_the_record_is_retained(): void
    {
        $admin = $this->user('admin');
        $receptionist = $this->user('receptionist');
        $patient = Patient::create(['patient_number' => 'PAT-VOID-1', 'first_name' => 'Veda', 'phone' => '9000010002', 'created_by' => $admin->id]);
        $invoice = Invoice::create(['invoice_number' => 'INV-VOID-1', 'patient_id' => $patient->id, 'invoice_date' => today(), 'subtotal' => 300, 'discount_amount' => 0, 'total_amount' => 300, 'status' => 'unpaid', 'created_by' => $admin->id]);

        $this->asUser($receptionist)->postJson("/api/v1/invoices/{$invoice->id}/void")->assertForbidden();
        $this->asUser($admin)->postJson("/api/v1/invoices/{$invoice->id}/void")->assertOk()->assertJsonPath('data.status', 'void');

        $this->assertDatabaseHas('invoices', ['id' => $invoice->id, 'status' => 'void']);
    }

    public function test_rescheduling_cannot_overlap_another_active_doctor_appointment(): void
    {
        $admin = $this->user('admin');
        $doctor = Doctor::create(['display_name' => 'Dr Schedule', 'consultation_fee' => 500, 'is_active' => true]);
        $patient = Patient::create(['patient_number' => 'PAT-RESCHEDULE-1', 'first_name' => 'Ravi', 'phone' => '9000010003', 'created_by' => $admin->id]);
        $target = Appointment::create([
            'appointment_number' => 'APT-RESCHEDULE-1', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id,
            'appointment_date' => today(), 'start_time' => '09:00', 'end_time' => '09:30', 'visit_type' => 'appointment',
            'status' => 'booked', 'token_number' => 1, 'created_by' => $admin->id,
        ]);
        Appointment::create([
            'appointment_number' => 'APT-RESCHEDULE-2', 'patient_id' => $patient->id, 'doctor_id' => $doctor->id,
            'appointment_date' => today(), 'start_time' => '10:00', 'end_time' => '10:30', 'visit_type' => 'appointment',
            'status' => 'booked', 'token_number' => 2, 'created_by' => $admin->id,
        ]);

        $this->asUser($admin)->putJson("/api/v1/appointments/{$target->id}", [
            'appointment_date' => today()->toDateString(), 'start_time' => '10:15', 'end_time' => '10:45',
        ])->assertStatus(422)->assertJsonPath('message', 'The doctor already has an appointment in this time range.');

        $this->assertDatabaseHas('appointments', ['id' => $target->id, 'start_time' => '09:00']);
    }
}
