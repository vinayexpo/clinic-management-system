<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A template as it exists in the connected Meta WhatsApp account.
 *
 * This is a read model of Meta's catalog. Clinic wording and per-event links
 * live on WhatsAppTemplate; nothing here is sent until an administrator
 * explicitly publishes from the clinic settings screen.
 */
class WhatsAppMetaTemplate extends Model
{
    protected $table = 'whatsapp_meta_templates';

    protected $fillable = [
        'waba_id', 'meta_template_id', 'name', 'language', 'category', 'status',
        'parameter_format', 'components', 'body', 'footer', 'placeholders',
        'supported', 'unsupported_reason', 'remote_hash', 'missing', 'last_synced_at',
        'header_type', 'header_example', 'button_summary', 'button_parameter_count', 'header_parameter_count',
    ];

    protected function casts(): array
    {
        return [
            'components' => 'array',
            'placeholders' => 'array',
            'button_summary' => 'array',
            'button_parameter_count' => 'integer',
            'header_parameter_count' => 'integer',
            'supported' => 'boolean',
            'missing' => 'boolean',
            'last_synced_at' => 'datetime',
        ];
    }
}
