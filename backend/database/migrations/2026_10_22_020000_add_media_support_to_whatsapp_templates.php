<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('whatsapp_meta_templates', function (Blueprint $table): void {
            // The header of a Meta template: TEXT, IMAGE, VIDEO, AUDIO or DOCUMENT.
            $table->string('header_type', 16)->nullable();
            $table->string('header_example')->nullable();
            $table->json('button_summary')->nullable();
            $table->unsignedSmallInteger('button_parameter_count')->default(0);
            $table->unsignedSmallInteger('header_parameter_count')->default(0);
        });

        Schema::table('whatsapp_templates', function (Blueprint $table): void {
            // Public link sent for a template that carries a photo, video, audio or document header.
            $table->string('media_url')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('whatsapp_templates', function (Blueprint $table): void {
            $table->dropColumn('media_url');
        });

        Schema::table('whatsapp_meta_templates', function (Blueprint $table): void {
            $table->dropColumn(['header_type', 'header_example', 'button_summary', 'button_parameter_count', 'header_parameter_count']);
        });
    }
};
