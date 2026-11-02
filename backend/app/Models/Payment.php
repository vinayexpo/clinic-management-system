<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Payment extends Model
{
    protected $fillable = ['payment_number', 'invoice_id', 'amount', 'payment_method', 'transaction_reference', 'paid_at', 'received_by', 'status', 'entry_type', 'reversal_of_id', 'notes'];

    protected $casts = ['amount' => 'decimal:2', 'paid_at' => 'datetime'];

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function reversalOf(): BelongsTo
    {
        return $this->belongsTo(self::class, 'reversal_of_id');
    }
}
