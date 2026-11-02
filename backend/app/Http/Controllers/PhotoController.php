<?php

namespace App\Http\Controllers;

use App\Models\Patient;
use App\Models\User;
use App\Support\ApiHelpers;
use App\Support\Avatars;
use App\Support\ListQuery;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Management of every profile photo in the clinic.
 *
 * Listing merges staff and patients in one searchable, paginated view.
 * Photos stay on the private disk and are served through the avatar routes.
 */
class PhotoController extends Controller
{
    use ApiHelpers;

    /** Clinic staff manage photos; patients only ever change their own. */
    private function requireStaff(Request $request): void
    {
        $this->requireRole($request, 'admin', 'doctor', 'receptionist');
    }

    /**
     * An administrator manages every photo. Other staff manage only the photos
     * of accounts in their own role, and never patient photos.
     */
    private function scope(Request $request): string
    {
        $role = (string) $request->user()->role;

        return $role === 'admin' ? 'all' : $role;
    }

    /**
     * Accept both the singular row type and the plural group name.
     */
    private function normalizeType(?string $type): ?string
    {
        return match ($type) {
            'staff' => 'staff',
            'patient', 'patients' => 'patients',
            default => null,
        };
    }

    public function index(Request $request): JsonResponse
    {
        $this->requireStaff($request);
        $data = $request->validate([
            'type' => ['sometimes', 'in:all,staff,patient,patients'],
            'search' => ['sometimes', 'string', 'max:80'],
            'has_photo' => ['sometimes', 'in:0,1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $scope = $this->scope($request);

        $staff = DB::table('users')
            ->selectRaw("id, 'staff' as type, name as label, role as detail, avatar_path, updated_at")
            // A portal account shares the photo stored on its patient record, so it is not listed twice.
            ->whereNotIn('id', DB::table('patients')->whereNotNull('user_id')->select('user_id'));

        $patients = DB::table('patients')
            ->selectRaw("id, 'patient' as type, trim(concat(first_name, ' ', coalesce(last_name, ''))) as label, patient_number as detail, avatar_path, updated_at")
            ->whereNull('deleted_at');

        $union = $scope === 'all'
            ? $staff->unionAll($patients)
            : DB::table('users')
                ->selectRaw("id, 'staff' as type, name as label, role as detail, avatar_path, updated_at")
                ->where('role', $scope);
        $query = DB::query()->fromSub($union, 'people');

        if ($scope === 'all') {
            $requested = ($data['type'] ?? 'all') === 'all' ? null : $this->normalizeType($data['type']);
            if ($requested) {
                // The API speaks in plural groups; the rows carry a singular type.
                $query->where('type', $requested === 'patients' ? 'patient' : 'staff');
            }
        } else {
            $query->where('type', 'staff');
        }
        if (array_key_exists('has_photo', $data)) {
            $query->when(
                $data['has_photo'] === '1',
                fn (Builder $q) => $q->whereNotNull('avatar_path'),
                fn (Builder $q) => $q->whereNull('avatar_path'),
            );
        }
        if (! empty($data['search'])) {
            $term = ListQuery::like($data['search']);
            $query->where(fn (Builder $q) => $q->where('label', 'like', $term)->orWhere('detail', 'like', $term));
        }

        $page = $query->orderBy('label')->paginate(ListQuery::perPage($request, 24));
        $page->getCollection()->transform(fn (object $row): array => [
            'type' => $row->type,
            'id' => (int) $row->id,
            'name' => $row->label !== '' ? $row->label : $row->detail,
            'detail' => $row->detail,
            'has_photo' => ! empty($row->avatar_path),
            'updated_at' => $row->updated_at,
        ]);

        return $this->ok($page);
    }

    /** Replace the photo of one staff member or patient. */
    public function update(Request $request, string $type, int $id): JsonResponse
    {
        $this->requireStaff($request);
        $type = $this->normalizeType($type);
        abort_unless($type, 404, 'Unknown photo owner.');
        $request->validate(['avatar' => ['required', 'image', 'max:2048', 'mimes:jpg,jpeg,png,webp']]);

        [$owner, $directory] = $this->owner($request, $type, $id);
        Avatars::delete($owner->avatar_path);
        $owner->update(['avatar_path' => Avatars::store($request->file('avatar'), $directory)]);

        $this->audit($request, 'updated', $type === 'staff' ? 'user' : 'patient', $owner->id, 'Profile photo replaced from the photo manager.');

        return $this->ok(['type' => $type, 'id' => $owner->id, 'has_photo' => true]);
    }

    /** Remove a profile photo. The record itself is never touched. */
    public function destroy(Request $request, string $type, int $id): JsonResponse
    {
        $this->requireStaff($request);
        $type = $this->normalizeType($type);
        abort_unless($type, 404, 'Unknown photo owner.');

        [$owner] = $this->owner($request, $type, $id);
        abort_unless($owner->avatar_path, 404, 'No photo to remove.');
        Avatars::delete($owner->avatar_path);
        $owner->update(['avatar_path' => null]);

        $this->audit($request, 'deleted', $type === 'staff' ? 'user' : 'patient', $owner->id, 'Profile photo removed from the photo manager.');

        return $this->ok(['type' => $type, 'id' => $owner->id, 'has_photo' => false]);
    }

    /** @return array{0:User|Patient,1:string} */
    private function owner(Request $request, string $type, int $id): array
    {
        $actorRole = (string) $request->user()->role;

        if ($type === 'staff') {
            $user = User::query()
                ->whereNotIn('id', DB::table('patients')->whereNotNull('user_id')->select('user_id'))
                ->find($id);
            abort_unless($user, 404, 'Unknown staff member.');
            abort_unless(
                $actorRole === 'admin' || $user->role === $actorRole,
                403,
                'You can only manage photos for accounts in your own role.',
            );

            return [$user, 'avatars/users'];
        }

        $patient = Patient::query()->find($id);
        abort_unless($patient, 404, 'Unknown patient.');
        abort_unless($actorRole === 'admin', 403, 'Only an administrator can manage patient photos.');

        return [$patient, 'avatars/patients'];
    }
}
