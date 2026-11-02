<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Profile photos live on the private disk and are only served through
 * authenticated API routes (plan §11: uploads stay private).
 */
final class Avatars
{
    public const DISK = 'local';

    public static function store(UploadedFile $file, string $directory): string
    {
        return $file->store($directory, self::DISK);
    }

    public static function delete(?string $path): void
    {
        if ($path && Storage::disk(self::DISK)->exists($path)) {
            Storage::disk(self::DISK)->delete($path);
        }
    }

    public static function respond(?string $path): StreamedResponse
    {
        abort_unless($path && Storage::disk(self::DISK)->exists($path), 404, 'No avatar.');

        return Storage::disk(self::DISK)->response($path);
    }
}
