<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('patients', function (Blueprint $table): void {
            // Consent is required before the clinic may message a patient.
            $table->boolean('whatsapp_opt_in')->default(false)->after('avatar_path');
        });

        Schema::table('appointments', function (Blueprint $table): void {
            // Reminders are sent at most once per appointment; this records that it happened.
            $table->timestamp('reminder_sent_at')->nullable()->after('cancel_reason');
            $table->string('reminder_kind')->nullable()->after('reminder_sent_at');
        });

        Schema::create('whatsapp_templates', function (Blueprint $table): void {
            $table->id();
            $table->string('event')->unique();
            $table->string('template_name');
            $table->text('body');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('whatsapp_messages', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('patient_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('appointment_id')->nullable()->constrained()->nullOnDelete();
            $table->string('event');
            $table->string('to_number', 32);
            $table->text('rendered_body');
            $table->json('parameters')->nullable();
            $table->string('status')->default('pending');
            $table->text('error')->nullable();
            $table->string('provider_message_id')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();

            $table->index(['patient_id', 'created_at']);
            $table->index('event');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('whatsapp_messages');
        Schema::dropIfExists('whatsapp_templates');

        Schema::table('appointments', function (Blueprint $table): void {
            $table->dropColumn(['reminder_sent_at', 'reminder_kind']);
        });

        Schema::table('patients', function (Blueprint $table): void {
            $table->dropColumn('whatsapp_opt_in');
        });
    }
};
