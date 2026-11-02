<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Single-row AI configuration: which OpenAI-compatible endpoint the clinic connects
 * to, the stored API key, the selected model, and which AI features are switched on.
 */
class AiSetting extends Model
{
    protected $fillable = ['base_url', 'api_key', 'model', 'features'];

    protected $casts = ['api_key' => 'encrypted', 'features' => 'array'];

    /** The saved singleton configuration, or null when never configured. */
    public static function current(): ?self
    {
        return self::query()->first();
    }

    /** True only when every needed credential is present. */
    public function configured(): bool
    {
        return filled($this->base_url) && filled($this->api_key) && filled($this->model);
    }

    /** Feature flags; an unconfigured features blob means every feature is available. */
    public function featureOn(string $key): bool
    {
        $features = $this->features;

        return is_array($features) ? (bool) ($features[$key] ?? true) : true;
    }

    /** The masked credential shown to administrators, e.g. ...f3a2. */
    public function maskedKey(): ?string
    {
        $key = (string) $this->api_key;
        if ($key === '') {
            return null;
        }

        return filled($key) && strlen($key) > 8 ? '•••••••• '.substr($key, -4) : '••••••••';
    }
}
