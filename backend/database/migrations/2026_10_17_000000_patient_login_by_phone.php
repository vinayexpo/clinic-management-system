<?php

use App\Models\Patient;
use App\Support\Phone;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Patients sign in by phone. Backfill the normalized phone onto existing portal accounts
     * from their linked patient record.
     */
    public function up(): void
    {
        Patient::whereNotNull('user_id')->with('user')->get()->each(function (Patient $patient): void {
            if (! $patient->user) {
                return;
            }
            $phone = Phone::normalize($patient->phone);
            if ($phone !== '') {
                DB::table('users')->where('id', $patient->user_id)->update(['phone' => $phone]);
            }
        });
    }

    public function down(): void
    {
        // Phones are data, not schema; leaving the backfilled values in place is safe.
    }
};
