<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('whatsapp_templates', function (Blueprint $table): void {
            // Link a clinic event to one template in the connected Meta account.
            $table->string('meta_template_id')->nullable()->index();
            $table->string('language', 16)->nullable();
            $table->string('category', 32)->nullable();
            // local, synced, draft, conflict, pending, uncertain, missing
            $table->string('sync_state', 20)->default('local');
            // Optimistic concurrency token for edits, imports and publishes.
            $table->unsignedInteger('revision')->default(1);
            // Remote content and local content at the last confirmed match.
            $table->string('baseline_hash', 64)->nullable();
            $table->string('baseline_local_hash', 64)->nullable();
            $table->json('bindings')->nullable();
            $table->string('pending_hash', 64)->nullable();
            $table->string('pending_action', 16)->nullable();
            $table->text('sync_error')->nullable();
            $table->timestamp('last_synced_at')->nullable();
        });

        Schema::create('whatsapp_meta_templates', function (Blueprint $table): void {
            $table->id();
            $table->string('waba_id')->index();
            $table->string('meta_template_id');
            $table->string('name');
            $table->string('language', 16);
            $table->string('category', 32)->nullable();
            $table->string('status', 32)->nullable();
            $table->string('parameter_format', 16)->nullable();
            $table->json('components');
            $table->text('body')->nullable();
            $table->text('footer')->nullable();
            $table->json('placeholders')->nullable();
            $table->boolean('supported')->default(false);
            $table->string('unsupported_reason')->nullable();
            $table->string('remote_hash', 64);
            $table->boolean('missing')->default(false);
            $table->timestamp('last_synced_at')->nullable();
            $table->timestamps();

            $table->unique(['waba_id', 'meta_template_id']);
            $table->index(['waba_id', 'name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('whatsapp_meta_templates');

        Schema::table('whatsapp_templates', function (Blueprint $table): void {
            $table->dropColumn([
                'meta_template_id', 'language', 'category', 'sync_state', 'revision',
                'baseline_hash', 'baseline_local_hash', 'bindings', 'pending_hash',
                'pending_action', 'sync_error', 'last_synced_at',
            ]);
        });
    }
};
