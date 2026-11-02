<?php

namespace App\Support;

use App\Models\WhatsAppConnection;

/**
 * Resolves the WhatsApp account that sends messages for this clinic.
 *
 * A connected WhatsApp Business app number (Coexistence) is preferred. When it
 * is not connected, the standard Cloud API credentials configured on the server
 * are used instead, so reminders and manual sends keep working.
 */
class WhatsAppSender
{
    /**
     * The WhatsApp Business account used to read templates and send messages.
     *
     * @return array{phone_number_id:string,token:string,waba_id:string,source:string,phone_number:string}|null
     */
    public static function resolve(): ?array
    {
        $connection = WhatsAppConnection::query()->find(1);

        if ($connection && $connection->status === 'connected') {
            return [
                'phone_number_id' => (string) $connection->phone_number_id,
                'token' => (string) $connection->token,
                'waba_id' => (string) $connection->waba_id,
                'source' => 'coexistence',
                'phone_number' => (string) $connection->display_phone_number,
            ];
        }

        $phoneNumberId = (string) config('whatsapp.phone_number_id');
        $token = (string) config('whatsapp.access_token');

        if ($phoneNumberId === '' || $token === '') {
            return null;
        }

        return [
            'phone_number_id' => $phoneNumberId,
            'token' => $token,
            'waba_id' => (string) config('whatsapp.business_account_id'),
            'source' => 'standard',
            'phone_number' => (string) (config('whatsapp.phone_number') ?: $phoneNumberId),
        ];
    }

    /**
     * Credentials for reading the template catalog of the active account.
     *
     * @return array{waba_id:string,token:string}|null
     */
    public static function account(): ?array
    {
        $connection = WhatsAppConnection::query()->find(1);

        if ($connection && $connection->status === 'connected') {
            return ['waba_id' => (string) $connection->waba_id, 'token' => (string) $connection->token];
        }

        $wabaId = (string) config('whatsapp.business_account_id');
        $token = (string) config('whatsapp.access_token');

        return $wabaId !== '' && $token !== '' ? ['waba_id' => $wabaId, 'token' => $token] : null;
    }

    /** @return array{source:?string,phone_number:?string,coexistence_connected:bool} */
    public static function describe(): array
    {
        $sender = self::resolve();
        $connection = WhatsAppConnection::query()->find(1);

        return [
            'source' => $sender['source'] ?? null,
            'phone_number' => $sender['phone_number'] ?? null,
            'coexistence_connected' => (bool) ($connection && $connection->status === 'connected'),
        ];
    }
}
