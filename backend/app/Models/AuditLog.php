<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AuditLog extends Model
{
    public $timestamps = false;

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    protected $fillable = ['user_id', 'action', 'entity_type', 'entity_id', 'summary', 'ip_address', 'user_agent', 'created_at'];

    protected $casts = ['created_at' => 'datetime'];
}
