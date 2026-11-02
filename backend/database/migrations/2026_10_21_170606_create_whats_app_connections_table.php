<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('whatsapp_connections', function (Blueprint $table) {
            $table->id();
            $table->string('waba_id');
            $table->string('phone_number_id');
            $table->string('display_phone_number');
            $table->text('token');
            $table->string('status')->default('connected');
            $table->foreignId('connected_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('connected_at');
            $table->timestamp('disconnected_at')->nullable();
            $table->timestamp('last_webhook_at')->nullable();
            $table->timestamp('lifecycle_event_at')->nullable();
            $table->string('contacts_sync_request_id')->nullable();
            $table->string('history_sync_request_id')->nullable();
            $table->string('history_status')->default('pending');
            $table->unsignedTinyInteger('sync_progress')->default(0);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('whatsapp_connections');
    }
};
