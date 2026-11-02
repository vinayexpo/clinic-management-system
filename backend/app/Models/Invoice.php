<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Invoice extends Model
{
    protected $fillable = ['invoice_number', 'patient_id', 'visit_id', 'invoice_date', 'subtotal', 'discount_amount', 'total_amount', 'status', 'notes', 'created_by'];

    protected $casts = ['invoice_date' => 'date', 'subtotal' => 'decimal:2', 'discount_amount' => 'decimal:2', 'total_amount' => 'decimal:2'];

    public function items(): HasMany
    {
        return $this->hasMany(InvoiceItem::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function visit(): BelongsTo
    {
        return $this->belongsTo(Visit::class);
    }

    public function getPaidAmountAttribute(): string
    {
        return (string) max(0, (float) $this->payments()->whereIn('status', ['completed', 'reversed', 'refunded'])->sum('amount'));
    }

    public function getBalanceAttribute(): string
    {
        return (string) max(0, (float) $this->total_amount - (float) $this->paid_amount);
    }
}
