<?php

namespace App\Support;

use App\Models\AuditLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

trait ApiHelpers
{
    protected function ok(mixed $data, int $status = 200): JsonResponse
    {
        return response()->json(['data' => $data], $status);
    }

    protected function audit(Request $request, string $action, string $entityType, ?int $entityId, string $summary, ?int $userId = null): void
    {
        AuditLog::create([
            'user_id' => $userId ?? $request->user()?->id,
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'summary' => $summary,
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'created_at' => now(),
        ]);
    }

    protected function requireRole(Request $request, string ...$roles): void
    {
        abort_unless($request->user() && in_array($request->user()->role, $roles, true), 403, 'Forbidden.');
    }
}
