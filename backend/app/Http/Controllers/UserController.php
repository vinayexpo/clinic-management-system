<?php

namespace App\Http\Controllers;

use App\Models\Doctor;
use App\Models\User;
use App\Support\ApiHelpers;
use App\Support\Avatars;
use App\Support\ListQuery;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Admin-managed staff accounts (admin / doctor / receptionist).
 * Only admins reach these routes; there is no public registration after setup.
 */
class UserController extends Controller
{
    use ApiHelpers;

    /** Staff roles managed on the Staff page. Patient logins are created through the patient records. */
    private const ROLES = ['admin', 'doctor', 'receptionist'];

    public function index(Request $request): JsonResponse
    {
        $this->requireRole($request, 'admin');

        $query = User::query()->with('doctor')
            ->where('role', '!=', 'patient')
            ->when($request->filled('search'), function ($q) use ($request) {
                $term = ListQuery::like($request->string('search')->toString());
                $q->where(fn ($w) => $w->where('name', 'like', $term)->orWhere('email', 'like', $term)->orWhere('phone', 'like', $term)
                    ->orWhereHas('doctor', fn ($d) => $d->where('specialization', 'like', $term)->orWhere('registration_number', 'like', $term)));
            })
            ->when($request->filled('role') && in_array($request->role, self::ROLES, true), fn ($q) => $q->where('role', $request->role))
            ->when($request->filled('specialization'), fn ($q) => $q->whereHas('doctor', fn ($d) => $d->where('specialization', $request->string('specialization')->toString())))
            ->when($request->filled('is_active'), fn ($q) => $q->where('is_active', $request->boolean('is_active')));

        ListQuery::sort($query, $request, ['name', 'email', 'role', 'created_at', 'last_login_at'], 'name', 'asc');

        return $this->ok($query->paginate(ListQuery::perPage($request)));
    }

    public function show(Request $request, User $user): JsonResponse
    {
        $this->requireRole($request, 'admin');

        return $this->ok($user->load('doctor'));
    }

    public function store(Request $request): JsonResponse
    {
        $this->requireRole($request, 'admin');
        $data = $request->validate([
            'name' => 'required|string|max:100',
            'email' => 'required|email|max:190|unique:users,email',
            'phone' => 'nullable|string|max:30',
            'password' => 'required|string|min:8',
            'role' => ['required', Rule::in(self::ROLES)],
            'is_active' => 'sometimes|boolean',
            'avatar' => 'sometimes|image|max:2048|mimes:jpg,jpeg,png,webp',
            // doctor profile fields, used when role = doctor
            'qualification' => 'nullable|string|max:150',
            'specialization' => 'nullable|string|max:150',
            'registration_number' => 'nullable|string|max:80',
            'consultation_fee' => 'nullable|numeric|min:0',
        ]);

        // A patient photo belongs to the patient record, so it is never stored on the login.
        abort_if($data['role'] === 'patient' && $request->hasFile('avatar'), 422, 'Use the patient record to manage a patient photo.');

        $avatarPath = $request->hasFile('avatar') ? Avatars::store($request->file('avatar'), 'avatars/users') : null;

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'phone' => $data['phone'] ?? null,
            'password' => $data['password'],
            'role' => $data['role'],
            'is_active' => $data['is_active'] ?? true,
            'avatar_path' => $avatarPath,
        ]);

        if ($user->role === 'doctor') {
            Doctor::create([
                'user_id' => $user->id,
                'display_name' => $user->name,
                'qualification' => $data['qualification'] ?? null,
                'specialization' => $data['specialization'] ?? null,
                'registration_number' => $data['registration_number'] ?? null,
                'consultation_fee' => $data['consultation_fee'] ?? 0,
                'is_active' => $user->is_active,
            ]);
        }

        $this->audit($request, 'created', 'user', $user->id, "User created with role {$user->role}.");

        return $this->ok($user->load('doctor'), 201);
    }

    public function update(Request $request, User $user): JsonResponse
    {
        $this->requireRole($request, 'admin');
        $data = $request->validate([
            'name' => 'sometimes|string|max:100',
            'email' => ['sometimes', 'email', 'max:190', Rule::unique('users', 'email')->ignore($user->id)],
            'phone' => 'nullable|string|max:30',
            'password' => 'sometimes|nullable|string|min:8',
            'role' => ['sometimes', Rule::in(self::ROLES)],
            'is_active' => 'sometimes|boolean',
            'avatar' => 'sometimes|nullable|image|max:2048|mimes:jpg,jpeg,png,webp',
            'remove_avatar' => 'sometimes|boolean',
            'qualification' => 'sometimes|nullable|string|max:150',
            'specialization' => 'sometimes|nullable|string|max:150',
            'registration_number' => 'sometimes|nullable|string|max:80',
            'consultation_fee' => 'sometimes|numeric|min:0',
        ]);

        // Patient accounts are managed from the patient record, never from the staff screen.
        abort_if($user->role === 'patient', 422, 'Patient logins are managed from the patient record.');
        abort_if(isset($data['role']) && $data['role'] === 'patient', 422, 'Use the patient record to create a patient login.');

        // Guard: never let the last active admin be demoted or deactivated.
        $losesAdmin = ($data['role'] ?? $user->role) !== 'admin' || (isset($data['is_active']) && ! $data['is_active']);
        if ($user->role === 'admin' && $losesAdmin) {
            abort_if(User::where('role', 'admin')->where('is_active', true)->where('id', '!=', $user->id)->doesntExist(), 422, 'At least one active administrator must remain.');
        }

        if (empty($data['password'])) {
            unset($data['password']);
        }
        if ($request->hasFile('avatar')) {
            Avatars::delete($user->avatar_path);
            $data['avatar_path'] = Avatars::store($request->file('avatar'), 'avatars/users');
        } elseif ($request->boolean('remove_avatar')) {
            Avatars::delete($user->avatar_path);
            $data['avatar_path'] = null;
        }
        unset($data['avatar'], $data['remove_avatar']);
        $doctorFields = collect($data)->only(['qualification', 'specialization', 'registration_number', 'consultation_fee'])->all();
        unset($data['qualification'], $data['specialization'], $data['registration_number'], $data['consultation_fee']);
        $oldRole = $user->role;
        $newRole = $data['role'] ?? $oldRole;

        DB::transaction(function () use ($user, $data, $doctorFields, $oldRole, $newRole): void {
            $user->update($data);
            if ($oldRole === 'doctor' && $newRole !== 'doctor') {
                $user->doctor?->update(['is_active' => false]);
            } elseif ($newRole === 'doctor') {
                $doctor = $user->doctor ?? new Doctor(['user_id' => $user->id, 'consultation_fee' => 0]);
                $doctor->fill($doctorFields + [
                    'display_name' => $user->name,
                    'is_active' => $user->is_active,
                ]);
                $doctor->save();
            }
        });

        $this->audit($request, 'updated', 'user', $user->id, 'User updated.');

        return $this->ok($user->fresh('doctor'));
    }

    public function destroy(Request $request, User $user): JsonResponse
    {
        $this->requireRole($request, 'admin');
        abort_if($user->id === $request->user()->id, 422, 'You cannot deactivate your own account.');
        abort_if($user->role === 'admin' && User::where('role', 'admin')->where('is_active', true)->where('id', '!=', $user->id)->doesntExist(), 422, 'At least one active administrator must remain.');

        // Soft-deactivate: clinical and financial records reference this user, so the row is never deleted.
        $user->update(['is_active' => false]);
        $user->doctor?->update(['is_active' => false]);
        $user->tokens()->delete();
        $this->audit($request, 'deactivated', 'user', $user->id, 'User deactivated and sessions revoked.');

        return $this->ok(['message' => 'User deactivated.']);
    }

    public function reactivate(Request $request, User $user): JsonResponse
    {
        $this->requireRole($request, 'admin');
        $user->update(['is_active' => true]);
        $user->doctor?->update(['is_active' => true]);
        $this->audit($request, 'reactivated', 'user', $user->id, 'User reactivated.');

        return $this->ok($user->fresh('doctor'));
    }

    public function avatar(Request $request, User $user): mixed
    {
        // Users may view their own photo; admins may view any.
        abort_unless($request->user()->role === 'admin' || $request->user()->id === $user->id, 403, 'Forbidden.');

        return Avatars::respond($user->avatar_path);
    }
}
