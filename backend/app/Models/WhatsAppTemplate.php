<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class WhatsAppTemplate extends Model
{
    // The table name is set explicitly: the default pluraliser would use "whats_app_templates".
    protected $table = 'whatsapp_templates';

    protected $fillable = [
        'event', 'template_name', 'body', 'is_active', 'meta_template_id', 'language',
        'category', 'sync_state', 'revision', 'baseline_hash', 'baseline_local_hash',
        'bindings', 'pending_hash', 'pending_action', 'sync_error', 'last_synced_at', 'media_url',
    ];

    /** Mirrors the schema defaults so a just-created template already has a revision. */
    protected $attributes = [
        'sync_state' => 'local',
        'revision' => 1,
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'bindings' => 'array',
            'revision' => 'integer',
            'last_synced_at' => 'datetime',
        ];
    }

    public function messages(): HasMany
    {
        return $this->hasMany(WhatsAppMessage::class, 'event', 'event');
    }
}
