<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WhatsAppConnection extends Model
{
    protected $table = 'whatsapp_connections';

    protected $fillable = ['id', 'waba_id', 'phone_number_id', 'display_phone_number', 'token', 'status', 'connected_by', 'connected_at', 'disconnected_at', 'last_webhook_at', 'lifecycle_event_at', 'contacts_sync_request_id', 'history_sync_request_id', 'history_status', 'sync_progress'];

    protected $hidden = ['token'];

    protected function casts(): array
    {
        return [
            'token' => 'encrypted',
            'connected_at' => 'datetime',
            'disconnected_at' => 'datetime',
            'last_webhook_at' => 'datetime',
            'lifecycle_event_at' => 'datetime',
            'sync_progress' => 'integer',
        ];
    }
}
