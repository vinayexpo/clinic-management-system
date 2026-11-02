<?php

namespace App\Support;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Minimal WhatsApp Business Cloud API client.
 *
 * Business-initiated messages (reminders, confirmations) must use an approved
 * template, so sends always go out as a template message with ordered parameters.
 */
class WhatsAppClient
{
    /**
     * @param  list<string>  $parameters
     * @param  array{type:string,link:string}|null  $header  Photo, video, audio or document for the message.
     * @return array{ok:bool,message_id:?string,error:?string,status:int}
     */
    public function sendTemplate(string $to, string $templateName, array $parameters, string $language = 'en', ?array $header = null): array
    {
        $sender = WhatsAppSender::resolve();

        if (! $sender) {
            return ['ok' => false, 'message_id' => null, 'error' => 'WhatsApp is not connected. Connect the WhatsApp Business app number, or set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN on the server.', 'status' => 0];
        }

        $phoneNumberId = $sender['phone_number_id'];
        $token = $sender['token'];

        $url = sprintf(
            '%s/%s/%s/messages',
            rtrim((string) config('whatsapp.api_base'), '/'),
            config('whatsapp.graph_version'),
            $phoneNumberId,
        );

        $payload = [
            'messaging_product' => 'whatsapp',
            'to' => $to,
            'type' => 'template',
            'template' => [
                'name' => $templateName,
                'language' => ['code' => $language],
                'components' => array_values(array_filter([
                    $header ? [
                        'type' => 'header',
                        'parameters' => [[
                            'type' => $header['type'],
                            $header['type'] => ['link' => $header['link']],
                        ]],
                    ] : null,
                    [
                        'type' => 'body',
                        'parameters' => array_map(fn ($value) => ['type' => 'text', 'text' => (string) $value], $parameters),
                    ],
                ])),
            ],
        ];

        try {
            $response = $this->request($token)->post($url, $payload);
        } catch (\Throwable $e) {
            Log::warning('WhatsApp send failed.', ['error' => $e->getMessage()]);

            return ['ok' => false, 'message_id' => null, 'error' => $e->getMessage(), 'status' => 0];
        }

        if ($response->successful()) {
            $messageId = $response->json('messages.0.id');

            return ['ok' => true, 'message_id' => is_string($messageId) ? $messageId : null, 'error' => null, 'status' => $response->status()];
        }

        $error = $response->json('error.message') ?? 'WhatsApp API returned '.$response->status();

        return ['ok' => false, 'message_id' => null, 'error' => (string) $error, 'status' => $response->status()];
    }

    private function request(string $token): PendingRequest
    {
        return Http::withToken($token)
            ->acceptJson()
            ->asJson()
            ->timeout((int) config('whatsapp.timeout', 10));
    }
}
