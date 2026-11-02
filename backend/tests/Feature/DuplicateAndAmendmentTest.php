<?php

namespace Tests\Feature;

use App\Models\Doctor;
use App\Models\Patient;
use App\Models\User;
use App\Models\Visit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DuplicateAndAmendmentTest extends TestCase
{
    use RefreshDatabase;

    public function test_created_visit_includes_persisted_defaults_and_matches_immediate_get(): void
    {
        $this->assertSame('sqlite', config('database.default'));
        $this->assertSame(':memory:', config('database.connections.sqlite.database'));

        $doctorUser = User::factory()->create(['role' => 'doctor', 'is_active' => true]);
        $doctor = Doctor::create(['user_id' => $doctorUser->id, 'display_name' => 'Dr Consultation']);
        $patient = Patient::create(['patient_number' => 'PAT-CONSULTATION', 'first_name' => 'Asha', 'phone' => '9000010020', 'created_by' => $doctorUser->id]);
        $admin = User::factory()->create(['role' => 'admin', 'is_active' => true]);

        foreach ([$doctorUser, $admin] as $user) {
            $created = $this->actingAs($user)->postJson('/api/v1/visits', [
                'patient_id' => $patient->id,
                'doctor_id' => $doctor->id,
            ])->assertCreated()->assertJsonPath('data.status', 'draft');

            $visit = $created->json('data');
            foreach (['appointment_id', 'symptoms', 'vitals', 'examination_notes', 'diagnosis', 'treatment_plan', 'follow_up_date', 'finalized_at'] as $field) {
                $this->assertArrayHasKey($field, $visit);
                $this->assertNull($visit[$field]);
            }
            $created->assertJsonPath('data.patient.id', $patient->id)
                ->assertJsonPath('data.doctor.id', $doctor->id)
                ->assertJsonPath('data.prescriptions', [])
                ->assertJsonPath('data.amendments', [])
                ->assertJsonPath('data.created_by', $user->id);

            $this->getJson('/api/v1/visits/'.$visit['id'])
                ->assertOk()->assertExactJson($created->json());
            $this->assertDatabaseHas('visits', ['id' => $visit['id'], 'status' => 'draft']);
        }
    }

    public function test_visit_creation_retains_authentication_role_and_doctor_scope_checks(): void
    {
        $doctorUser = User::factory()->create(['role' => 'doctor', 'is_active' => true]);
        $doctor = Doctor::create(['user_id' => $doctorUser->id, 'display_name' => 'Dr Assigned']);
        $patient = Patient::create(['patient_number' => 'PAT-VISIT-SCOPE', 'first_name' => 'Rohan', 'phone' => '9000010021', 'created_by' => $doctorUser->id]);
        $payload = ['patient_id' => $patient->id, 'doctor_id' => $doctor->id];

        $this->postJson('/api/v1/visits', $payload)->assertUnauthorized();

        foreach (['doctor', 'receptionist', 'patient'] as $role) {
            $user = User::factory()->create(['role' => $role, 'is_active' => true]);
            $this->actingAs($user)->postJson('/api/v1/visits', $payload)->assertForbidden();
        }

        $this->assertDatabaseCount('visits', 0);
    }

    public function test_check_duplicate_detects_matching_phone_or_name_and_dob(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'is_active' => true]);
        Patient::create([
            'patient_number' => 'PAT-100001',
            'first_name' => 'Aarav',
            'last_name' => 'Sharma',
            'phone' => '+91 98765 43210',
            'date_of_birth' => '1990-05-15',
            'sex' => 'male',
            'created_by' => $admin->id,
        ]);

        // Same normalized phone
        $resPhone = $this->actingAs($admin)
            ->getJson('/api/v1/patients/check-duplicates?phone=09876543210');
        $resPhone->assertOk();
        $this->assertCount(1, $resPhone->json('data.duplicates'));
        $this->assertEquals('PAT-100001', $resPhone->json('data.duplicates.0.patient_number'));

        // Same name and DOB
        $resNameDob = $this->actingAs($admin)
            ->getJson('/api/v1/patients/check-duplicates?first_name=Aarav&last_name=Sharma&date_of_birth=1990-05-15');
        $resNameDob->assertOk();
        $this->assertCount(1, $resNameDob->json('data.duplicates'));

        // Exclude own ID
        $patient = Patient::first();
        $resExclude = $this->actingAs($admin)
            ->getJson('/api/v1/patients/check-duplicates?phone=9876543210&exclude_id='.$patient->id);
        $resExclude->assertOk();
        $this->assertCount(0, $resExclude->json('data.duplicates'));
    }

    public function test_amendment_workflow_on_finalized_visit(): void
    {
        $doctorUser = User::factory()->create(['role' => 'doctor', 'is_active' => true]);
        $doctor = Doctor::create([
            'user_id' => $doctorUser->id,
            'display_name' => 'Dr. Aditi Rao',
            'consultation_fee' => 500,
            'is_active' => true,
        ]);
        $patient = Patient::create([
            'patient_number' => 'PAT-200001',
            'first_name' => 'Rohan',
            'phone' => '9876512345',
            'created_by' => $doctorUser->id,
        ]);

        $visit = Visit::create([
            'visit_number' => 'VIS-100001',
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'visit_date' => now()->toDateString(),
            'diagnosis' => 'Viral fever',
            'status' => 'draft',
            'created_by' => $doctorUser->id,
        ]);

        // Attempting to amend a draft visit should be rejected
        $this->actingAs($doctorUser)
            ->postJson("/api/v1/visits/{$visit->id}/amendments", [
                'reason' => 'Lab follow-up',
                'notes' => 'CBC report reviewed.',
            ])->assertStatus(422);

        // Finalize visit
        $this->actingAs($doctorUser)
            ->postJson("/api/v1/visits/{$visit->id}/finalize")
            ->assertOk();

        $this->assertEquals('finalized', $visit->fresh()->status);

        // Doctor creates an amendment
        $amendRes = $this->actingAs($doctorUser)
            ->postJson("/api/v1/visits/{$visit->id}/amendments", [
                'reason' => 'Lab follow-up',
                'notes' => 'CBC report reviewed: Platelets normal. Continue paracetamol as needed.',
            ]);

        $amendRes->assertStatus(201);
        $this->assertEquals('Lab follow-up', $amendRes->json('data.reason'));

        // Visit status should now be amended
        $refreshed = $visit->fresh();
        $this->assertEquals('amended', $refreshed->status);
        $this->assertCount(1, $refreshed->amendments);
        $this->assertEquals('Lab follow-up', $refreshed->amendments->first()->reason);

        // Receptionist cannot amend consultations
        $receptionist = User::factory()->create(['role' => 'receptionist', 'is_active' => true]);
        $this->actingAs($receptionist)
            ->postJson("/api/v1/visits/{$visit->id}/amendments", [
                'reason' => 'Unauthorized attempt',
                'notes' => 'Should fail',
            ])->assertStatus(403);
    }
}
