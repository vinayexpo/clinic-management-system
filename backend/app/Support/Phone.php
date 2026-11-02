<?php

namespace App\Support;

/**
 * Canonical phone form used for patient sign-in: digits only, without a leading
 * India country code (+91 / 91) or trunk zero. "+91 98765-43210", "098765 43210"
 * and "9876543210" all normalize to "9876543210".
 */
final class Phone
{
    public static function normalize(?string $raw): string
    {
        $digits = preg_replace('/\D+/', '', (string) $raw) ?? '';

        if (strlen($digits) === 12 && str_starts_with($digits, '91')) {
            $digits = substr($digits, 2);
        } elseif (strlen($digits) === 11 && str_starts_with($digits, '0')) {
            $digits = substr($digits, 1);
        }

        return $digits;
    }

    /**
     * E.164 format required by the WhatsApp Business API, e.g. "+919876543210".
     * Returns null when the number is too short to be a valid international number.
     */
    public static function toE164(?string $raw, ?string $countryCode = null): ?string
    {
        $digits = self::normalize($raw);
        if (strlen($digits) < 8) {
            return null;
        }

        $code = ltrim($countryCode ?? (string) config('whatsapp.country_code', '91'), '+');
        // A number that already carries the country code is not prefixed twice.
        if (strlen($digits) === 12 && str_starts_with($digits, $code)) {
            $digits = substr($digits, strlen($code));
        }

        return '+'.$code.$digits;
    }
}
