<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Audit trail of every WhatsApp message the clinic attempted to send.
 */
class WhatsAppMessage extends Model
{
    // The table name is set explicitly: the default pluraliser would use "whats_app_messages".
    protected $table = 'whatsapp_messages';

    protected $fillable = [
        'patient_id', 'appointment_id', 'event', 'to_number', 'rendered_body',
        'parameters', 'status', 'error', 'provider_message_id', 'sent_at',
    ];

    protected $casts = [
        'parameters' => 'array',
        'sent_at' => 'datetime',
    ];

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function appointment(): BelongsTo
    {
        return $this->belongsTo(Appointment::class);
    }
}
