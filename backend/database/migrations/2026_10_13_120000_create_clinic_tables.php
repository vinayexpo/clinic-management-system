<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->string('phone')->nullable()->index();
            $table->string('role')->default('receptionist')->index();
            $table->boolean('is_active')->default(true);
            $table->timestamp('last_login_at')->nullable();
        });
        Schema::create('doctors', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('display_name');
            $table->string('qualification')->nullable();
            $table->string('specialization')->nullable();
            $table->string('registration_number')->nullable();
            $table->decimal('consultation_fee', 12, 2)->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
        Schema::create('patients', function (Blueprint $table): void {
            $table->id();
            $table->string('patient_number')->unique();
            $table->string('first_name');
            $table->string('last_name')->nullable();
            $table->date('date_of_birth')->nullable();
            $table->string('sex')->nullable();
            $table->string('phone')->index();
            $table->string('email')->nullable();
            $table->text('address')->nullable();
            $table->string('emergency_contact_name')->nullable();
            $table->string('emergency_contact_phone')->nullable();
            $table->text('allergies_summary')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();
        });
        Schema::create('appointments', function (Blueprint $table): void {
            $table->id();
            $table->string('appointment_number')->unique();
            $table->foreignId('patient_id')->constrained();
            $table->foreignId('doctor_id')->constrained();
            $table->date('appointment_date')->index();
            $table->time('start_time');
            $table->time('end_time')->nullable();
            $table->string('visit_type')->default('appointment');
            $table->unsignedInteger('token_number')->nullable();
            $table->string('status')->default('booked')->index();
            $table->string('reason_for_visit')->nullable();
            $table->string('cancel_reason')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['doctor_id', 'appointment_date', 'token_number']);
        });
        Schema::create('visits', function (Blueprint $table): void {
            $table->id();
            $table->string('visit_number')->unique();
            $table->foreignId('patient_id')->constrained();
            $table->foreignId('appointment_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('doctor_id')->constrained();
            $table->date('visit_date')->index();
            $table->text('symptoms')->nullable();
            $table->json('vitals')->nullable();
            $table->text('examination_notes')->nullable();
            $table->text('diagnosis')->nullable();
            $table->text('treatment_plan')->nullable();
            $table->date('follow_up_date')->nullable();
            $table->string('status')->default('draft');
            $table->timestamp('finalized_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
        Schema::create('prescriptions', function (Blueprint $table): void {
            $table->id();
            $table->string('prescription_number')->unique();
            $table->foreignId('visit_id')->constrained();
            $table->foreignId('patient_id')->constrained();
            $table->foreignId('doctor_id')->constrained();
            $table->timestamp('issued_at')->nullable();
            $table->text('instructions')->nullable();
            $table->string('status')->default('draft');
            $table->timestamps();
        });
        Schema::create('prescription_items', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('prescription_id')->constrained()->cascadeOnDelete();
            $table->string('medicine_name');
            $table->string('strength')->nullable();
            $table->string('dosage');
            $table->string('route')->nullable();
            $table->string('frequency');
            $table->string('duration');
            $table->unsignedInteger('quantity')->nullable();
            $table->string('instructions')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });
        Schema::create('invoices', function (Blueprint $table): void {
            $table->id();
            $table->string('invoice_number')->unique();
            $table->foreignId('patient_id')->constrained();
            $table->foreignId('visit_id')->nullable()->constrained()->nullOnDelete();
            $table->date('invoice_date')->index();
            $table->decimal('subtotal', 12, 2);
            $table->decimal('discount_amount', 12, 2)->default(0);
            $table->decimal('total_amount', 12, 2);
            $table->string('status')->default('unpaid');
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
        Schema::create('invoice_items', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('invoice_id')->constrained()->cascadeOnDelete();
            $table->string('description');
            $table->decimal('quantity', 10, 2);
            $table->decimal('unit_price', 12, 2);
            $table->decimal('line_total', 12, 2);
            $table->timestamps();
        });
        Schema::create('payments', function (Blueprint $table): void {
            $table->id();
            $table->string('payment_number')->unique();
            $table->foreignId('invoice_id')->constrained();
            $table->decimal('amount', 12, 2);
            $table->string('payment_method');
            $table->string('transaction_reference')->nullable();
            $table->timestamp('paid_at');
            $table->foreignId('received_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('status')->default('completed');
            $table->text('notes')->nullable();
            $table->timestamps();
        });
        Schema::create('clinic_settings', function (Blueprint $table): void {
            $table->id();
            $table->string('clinic_name');
            $table->text('address')->nullable();
            $table->string('phone')->nullable();
            $table->string('email')->nullable();
            $table->string('timezone')->default('Asia/Kolkata');
            $table->unsignedInteger('appointment_slot_minutes')->default(15);
            $table->text('prescription_footer')->nullable();
            $table->string('invoice_prefix')->default('INV');
            $table->string('receipt_prefix')->default('RCT');
            $table->timestamps();
        });
        Schema::create('audit_logs', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action');
            $table->string('entity_type');
            $table->unsignedBigInteger('entity_id')->nullable();
            $table->string('summary');
            $table->ipAddress('ip_address')->nullable();
            $table->text('user_agent')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->index(['entity_type', 'entity_id']);
        });
    }

    public function down(): void
    {
        foreach (['audit_logs', 'clinic_settings', 'payments', 'invoice_items', 'invoices', 'prescription_items', 'prescriptions', 'visits', 'appointments', 'patients', 'doctors'] as $table) {
            Schema::dropIfExists($table);
        } Schema::table('users', fn (Blueprint $t) => $t->dropColumn(['phone', 'role', 'is_active', 'last_login_at']));
    }
};
