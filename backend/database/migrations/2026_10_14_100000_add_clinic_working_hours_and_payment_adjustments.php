<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clinic_settings', function (Blueprint $table): void {
            $table->string('logo_path')->nullable()->after('email');
            $table->json('working_hours')->nullable()->after('timezone');
        });

        Schema::table('payments', function (Blueprint $table): void {
            $table->foreignId('reversal_of_id')->nullable()->after('received_by')->constrained('payments')->nullOnDelete();
            $table->string('entry_type')->default('payment')->after('status');
            $table->index(['invoice_id', 'status', 'entry_type']);
        });

        Schema::create('doctor_schedules', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('doctor_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('day_of_week');
            $table->time('start_time');
            $table->time('end_time');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->unique(['doctor_id', 'day_of_week', 'start_time', 'end_time'], 'doctor_sched_slot_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('doctor_schedules');

        Schema::table('payments', function (Blueprint $table): void {
            $table->dropForeign(['reversal_of_id']);
            $table->dropIndex(['invoice_id', 'status', 'entry_type']);
            $table->dropColumn(['reversal_of_id', 'entry_type']);
        });

        Schema::table('clinic_settings', function (Blueprint $table): void {
            $table->dropColumn(['logo_path', 'working_hours']);
        });
    }
};
