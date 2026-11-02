<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WhatsAppWebhookEvent extends Model
{
    protected $table = 'whatsapp_webhook_events';

    public $timestamps = false;

    protected $fillable = ['fingerprint', 'waba_id', 'phone_number_id', 'field', 'payload', 'received_at'];

    protected $hidden = ['payload'];

    protected function casts(): array
    {
        return [
            'payload' => 'encrypted:array',
            'received_at' => 'datetime',
        ];
    }
}
