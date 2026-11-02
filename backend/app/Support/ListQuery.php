<?php

namespace App\Support;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

final class ListQuery
{
    public static function perPage(Request $request, int $default = 15): int
    {
        return min(100, max(1, $request->integer('per_page', $default)));
    }

    /**
     * Sort by a whitelisted column only; anything else falls back to the default.
     *
     * @param  list<string>  $sortable
     */
    public static function sort(Builder $query, Request $request, array $sortable, string $default, string $defaultDirection = 'desc'): Builder
    {
        $field = $request->string('sort')->toString();
        $column = in_array($field, $sortable, true) ? $field : $default;
        $direction = $request->string('direction')->lower()->toString() === 'asc' ? 'asc' : ($request->filled('direction') ? 'desc' : $defaultDirection);

        return $query->orderBy($column, $direction);
    }

    public static function dateRange(Builder $query, Request $request, string $column): Builder
    {
        return $query
            ->when($request->filled('date_from'), fn (Builder $q) => $q->whereDate($column, '>=', $request->string('date_from')->toString()))
            ->when($request->filled('date_to'), fn (Builder $q) => $q->whereDate($column, '<=', $request->string('date_to')->toString()));
    }

    public static function like(string $term): string
    {
        return '%'.addcslashes($term, '%_\\').'%';
    }
}
