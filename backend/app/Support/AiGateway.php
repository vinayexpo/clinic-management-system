<?php

namespace App\Support;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/** Thrown with a message the user can act on: wrong host, bad key, no network. */
class AiGatewayException extends \RuntimeException {}

/**
 * A small OpenAI-compatible client used both to list models and to run chat prompts.
 * Providers such as OpenAI, OpenRouter, Groq, Together, DeepSeek, LM Studio, Ollama
 * and vLLM all expose the /models and /chat/completions shapes used here.
 */
final class AiGateway
{
    public const TIMEOUT_SECONDS = 90;

    /**
     * The provider's own model catalogue.
     *
     * @return array{models: array<int, array<string, mixed>>, resolved_url: string}
     */
    public static function models(string $baseUrl, string $apiKey): array
    {
        [$response, $url] = self::resolveUrl($baseUrl, '/models', $apiKey);

        $items = self::jsonBody($response->body(), 'model list')['data'] ?? null;
        if (! is_array($items)) {
            throw new AiGatewayException('The API URL did not return a model list.');
        }

        $models = [];
        foreach ($items as $item) {
            $id = is_array($item) ? ($item['id'] ?? $item['name'] ?? null) : $item;
            if (! is_string($id) || $id === '' || array_key_exists($id, $models)) {
                continue;
            }
            $models[$id] = ['id' => $id, 'owned_by' => is_array($item) ? ($item['owned_by'] ?? null) : null];
        }
        if ($models === []) {
            throw new AiGatewayException('The API URL returned no selectable models for this key.');
        }

        $models = array_values($models);
        usort($models, fn (array $a, array $b): int => strcmp($a['id'], $b['id']));

        return ['models' => $models, 'resolved_url' => $url];
    }

    /**
     * Run a chat completion and return the reply text, or throw with a message the
     * interface can show unchanged.
     */
    public static function chat(string $baseUrl, string $apiKey, string $model, array $messages, float $temperature = 0.2): string
    {
        [$response, $url] = self::resolveUrl($baseUrl, '/chat/completions', $apiKey, [
            'model' => $model,
            'messages' => $messages,
            'temperature' => $temperature,
        ]);

        $content = self::jsonBody($response->body(), 'chat reply')['choices'][0]['message']['content'] ?? null;

        return is_string($content) ? trim($content) : '';
    }

    /**
     * Call the resource path under the base URL, first as written and then with a
     * /v1 suffix when the first attempt is a 404 and the base carries no version.
     *
     * @param  array<string, mixed>  $json
     * @return array{0: Response, 1: string}
     */
    private static function resolveUrl(string $baseUrl, string $path, string $apiKey, array $json = []): array
    {
        $baseUrl = rtrim(trim($baseUrl), '/');
        $direct = $baseUrl.$path;
        $response = self::call($direct, $apiKey, $json);

        if ($response->ok()) {
            return [$response, $direct];
        }

        // A rejected key is definitive for every path; say so instead of retrying.
        if (in_array($response->status(), [401, 403], true)) {
            throw new AiGatewayException(self::apiError($response));
        }

        if ($response->status() === 404 && preg_match('#/v\d+$#', $baseUrl) !== 1) {
            $versioned = $baseUrl.'/v1'.$path;
            $response = self::call($versioned, $apiKey, $json);
            if ($response->ok()) {
                return [$response, $versioned];
            }
        }

        throw new AiGatewayException(self::apiError($response));
    }

    private static function call(string $url, string $apiKey, array $json = []): Response
    {
        $request = Http::timeout(self::TIMEOUT_SECONDS)
            ->connectTimeout(10)
            ->withHeaders([
                'Authorization' => 'Bearer '.$apiKey,
                'Accept' => 'application/json',
                'Content-Type' => 'application/json',
            ]);

        try {
            return $json === [] ? $request->get($url) : $request->post($url, $json);
        } catch (ConnectionException $e) {
            throw new AiGatewayException('Could not reach '.parse_url($url, PHP_URL_HOST).' from the clinic server. Check the API URL and the server internet connection.');
        }
    }

    /** @return array<string, mixed> */
    private static function jsonBody(string $body, string $what): array
    {
        try {
            $payload = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new AiGatewayException("The provider did not return JSON for the {$what}.");
        }

        return is_array($payload) ? $payload : [];
    }

    /** Turn a provider error response into one readable sentence. */
    private static function apiError(Response $response): string
    {
        $detail = '';
        try {
            $payload = json_decode($response->body(), true, 512, JSON_THROW_ON_ERROR);
            $detail = is_array($payload)
                ? (string) ($payload['error']['message'] ?? $payload['message'] ?? '')
                : '';
        } catch (\JsonException) {
            $detail = '';
        }
        $detail = trim($detail) !== '' ? ' '.trim($detail) : '';

        if (in_array($response->status(), [401, 403], true)) {
            return "The API key was rejected by the provider.{$detail}";
        }
        if (in_array($response->status(), [404, 405], true)) {
            return 'The API URL did not look like an OpenAI-compatible endpoint.'.$detail;
        }
        if ($response->status() === 429) {
            return "The provider rate limit was hit. Wait a moment and try again.{$detail}";
        }
        if ($response->status() < 500) {
            return "The provider rejected the AI request.{$detail}";
        }

        return 'The provider had a problem serving the request (HTTP '.$response->status().").{$detail}";
    }
}
