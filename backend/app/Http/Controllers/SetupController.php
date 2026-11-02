<?php

namespace App\Http\Controllers;

use App\Models\ClinicSetting;
use App\Models\User;
use App\Support\ApiHelpers;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SetupController extends Controller
{
    use ApiHelpers;

    /**
     * Public: tells the SPA whether the first-run admin signup should be shown.
     * Signup is only available while no admin account exists.
     *
     * It also carries the clinic name and logo flag, so the sign-in screen can
     * show the clinic's own branding before anyone signs in.
     */
    public function status(): JsonResponse
    {
        $clinic = ClinicSetting::query()->first();

        return $this->ok([
            'needs_setup' => ! User::where('role', 'admin')->exists(),
            'clinic_name' => $clinic?->clinic_name,
            'has_logo' => (bool) $clinic?->logo_path,
            'theme' => $clinic?->theme,
        ]);
    }

    /**
     * Public, one-shot: creates the first admin. Locked permanently once any admin exists.
     */
    public function createAdmin(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:100',
            'email' => 'required|email|max:190|unique:users,email',
            'phone' => 'nullable|string|max:30',
            'password' => 'required|string|min:8|confirmed',
        ]);

        return DB::transaction(function () use ($data, $request) {
            // Lock the table row range so two simultaneous requests cannot both create an admin.
            $exists = User::where('role', 'admin')->lockForUpdate()->exists();
            abort_if($exists, 409, 'An administrator already exists. Signup is closed.');

            $admin = User::create([
                'name' => $data['name'],
                'email' => $data['email'],
                'phone' => $data['phone'] ?? null,
                'password' => $data['password'],
                'role' => 'admin',
                'is_active' => true,
            ]);

            $this->audit($request, 'created', 'user', $admin->id, 'Initial administrator created via first-run setup.', $admin->id);

            return $this->ok([
                'user' => $admin,
                'token' => $admin->createToken('clinic-api')->plainTextToken,
            ], 201);
        });
    }
}
