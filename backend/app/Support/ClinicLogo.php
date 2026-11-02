<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The clinic logo lives on the private disk and is only served through
 * authenticated API routes. Printed documents receive it as a data URI so the
 * print window can show it without an authenticated image request.
 */
final class ClinicLogo
{
    public const DISK = 'local';

    public const DIRECTORY = 'clinic/logo';

    /** Largest logo the print payload will carry inline. */
    public const MAX_INLINE_BYTES = 1024 * 1024;

    public static function store(UploadedFile $file): string
    {
        return $file->store(self::DIRECTORY, self::DISK);
    }

    public static function delete(?string $path): void
    {
        if ($path && Storage::disk(self::DISK)->exists($path)) {
            Storage::disk(self::DISK)->delete($path);
        }
    }

    public static function respond(?string $path): StreamedResponse
    {
        abort_unless($path && Storage::disk(self::DISK)->exists($path), 404, 'No clinic logo.');

        return Storage::disk(self::DISK)->response($path);
    }

    /** Inline data URI for printouts, or null when there is no usable logo. */
    public static function dataUri(?string $path): ?string
    {
        if (! $path || ! Storage::disk(self::DISK)->exists($path)) {
            return null;
        }

        $disk = Storage::disk(self::DISK);
        if ($disk->size($path) > self::MAX_INLINE_BYTES) {
            return null;
        }

        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $mime = match ($extension) {
            'png' => 'image/png',
            'jpg', 'jpeg' => 'image/jpeg',
            'webp' => 'image/webp',
            default => null,
        };

        if (! $mime) {
            return null;
        }

        $contents = $disk->get($path);
        if (! is_string($contents)) {
            return null;
        }

        return 'data:'.$mime.';base64,'.base64_encode($contents);
    }
}
