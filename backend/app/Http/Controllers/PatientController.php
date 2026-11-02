<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\ClinicSetting;
use App\Models\Doctor;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\User;
use App\Models\Visit;
use App\Support\ApiHelpers;
use App\Support\Avatars;
use App\Support\ClinicLogo;
use App\Support\ClinicNotifications;
use App\Support\ListQuery;
use App\Support\Phone;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Patient records. Admin owns create/update/delete and portal-login management.
 * Reception may register and edit demographics; doctors may read; a patient may read only their own record.
 * Portal patients sign in with their login phone number and password.
 */
class PatientController extends Controller
{
    use ApiHelpers;

    private function number(): string
    {
        return 'PAT-'.now()->format('ymdHis').'-'.str()->upper(str()->random(4));
    }

    public function index(Request $request): JsonResponse
    {
        $this->requireRole($request, 'admin', 'doctor', 'receptionist');

        $query = Patient::query()
            ->withCount('visits')
            ->with('user:id,phone')
            ->when($request->filled('search'), function ($q) use ($request) {
                $term = ListQuery::like($request->string('search')->toString());
                $q->where(fn ($w) => $w->where('first_name', 'like', $term)
                    ->orWhere('last_name', 'like', $term)
                    ->orWhere('patient_number', 'like', $term)
                    ->orWhere('phone', 'like', $term)
                    ->orWhere('email', 'like', $term));
            })
            ->when($request->filled('sex'), fn ($q) => $q->where('sex', $request->string('sex')->toString()))
            ->when($request->boolean('has_allergies'), fn ($q) => $q->whereNotNull('allergies_summary')->where('allergies_summary', '!=', ''))
            ->when($request->filled('has_login'), fn ($q) => $request->boolean('has_login') ? $q->whereNotNull('user_id') : $q->whereNull('user_id'))
            ->when($request->filled('age_min') || $request->filled('age_max'), function ($q) use ($request) {
                if ($request->filled('age_max')) {
                    $q->whereDate('date_of_birth', '>=', now()->subYears((int) $request->age_max + 1)->addDay()->toDateString());
                }
                if ($request->filled('age_min')) {
                    $q->whereDate('date_of_birth', '<=', now()->subYears((int) $request->age_min)->toDateString());
                }
            });

        ListQuery::dateRange($query, $request, 'created_at');
        ListQuery::sort($query, $request, ['first_name', 'patient_number', 'created_at', 'date_of_birth'], 'created_at', 'desc');

        return $this->ok($query->paginate(ListQuery::perPage($request)));
    }

    public function checkDuplicate(Request $request): JsonResponse
    {
        $this->requireRole($request, 'admin', 'receptionist', 'doctor');

        $phone = Phone::normalize($request->string('phone')->toString());
        $firstName = trim($request->string('first_name')->toString());
        $lastName = trim($request->string('last_name')->toString());
        $dob = $request->string('date_of_birth')->toString();
        $excludeId = $request->integer('exclude_id') ?: null;

        if (strlen($phone) < 6 && strlen($firstName) < 2) {
            return $this->ok(['duplicates' => []]);
        }

        $candidates = Patient::query()
            ->when($excludeId, fn ($q) => $q->where('id', '!=', $excludeId))
            ->where(function ($q) use ($phone, $firstName, $lastName, $dob) {
                $hasCondition = false;
                if (strlen($phone) >= 6) {
                    $q->where(function ($sub) use ($phone) {
                        $sub->where('phone', 'like', "%{$phone}%")
                            ->orWhereRaw("REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), '(', '') LIKE ?", ["%{$phone}%"]);
                    });
                    $hasCondition = true;
                }

                if (strlen($firstName) >= 2) {
                    $nameClosure = function ($sub) use ($firstName, $lastName, $dob) {
                        $sub->where('first_name', 'like', $firstName.'%');
                        if (strlen($lastName) >= 2) {
                            $sub->where('last_name', 'like', $lastName.'%');
                        }
                        if (! empty($dob)) {
                            $sub->whereDate('date_of_birth', $dob);
                        }
                    };

                    if ($hasCondition) {
                        $q->orWhere($nameClosure);
                    } else {
                        $q->where($nameClosure);
                    }
                }
            })
            ->limit(5)
            ->get();

        $duplicates = $candidates->map(function (Patient $p) use ($phone, $firstName, $lastName, $dob) {
            $reasons = [];
            $patientPhoneNorm = Phone::normalize($p->phone);
            if (strlen($phone) >= 6 && ($patientPhoneNorm === $phone || str_contains($patientPhoneNorm, $phone) || str_contains($phone, $patientPhoneNorm))) {
                $reasons[] = 'Matching phone number ('.$p->phone.')';
            }
            if (strlen($firstName) >= 2 && strcasecmp($p->first_name, $firstName) === 0) {
                if (strlen($lastName) >= 2 && strcasecmp((string) $p->last_name, $lastName) === 0) {
                    $reasons[] = 'Matching full name ('.$p->first_name.' '.$p->last_name.')';
                }
                if (! empty($dob) && $p->date_of_birth && $p->date_of_birth->toDateString() === $dob) {
                    $reasons[] = 'Matching birth date ('.$dob.')';
                }
            }
            if (empty($reasons)) {
                $reasons[] = 'Similar demographics';
            }

            return [
                'id' => $p->id,
                'patient_number' => $p->patient_number,
                'first_name' => $p->first_name,
                'last_name' => $p->last_name,
                'phone' => $p->phone,
                'date_of_birth' => $p->date_of_birth?->toDateString(),
                'created_at' => $p->created_at?->toIso8601String(),
                'match_reasons' => $reasons,
            ];
        });

        return $this->ok(['duplicates' => $duplicates]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->requireRole($request, 'admin', 'receptionist');
        $data = $request->validate($this->rules() + $this->loginRules());

        // Only admins may create a portal login; reception registers demographics only.
        $wantsLogin = ! empty($data['login_password']);
        if ($wantsLogin) {
            $this->requireRole($request, 'admin');
        }

        return DB::transaction(function () use ($request, $data, $wantsLogin) {
            $login = $wantsLogin ? $this->makeLogin($data) : null;

            $patient = Patient::create(array_merge($this->patientFields($data), [
                'patient_number' => $this->number(),
                'created_by' => $request->user()->id,
                'user_id' => $login?->id,
                'avatar_path' => $request->hasFile('avatar') ? Avatars::store($request->file('avatar'), 'avatars/patients') : null,
            ]));

            $this->audit($request, 'created', 'patient', $patient->id, $login ? 'Patient registered with portal login.' : 'Patient registered.');

            return $this->ok($patient->load('user'), 201);
        });
    }

    public function show(Request $request, Patient $patient): JsonResponse
    {
        $this->authorizePatientAccess($request, $patient);
        $relations = [
            'appointments' => fn ($q) => $q->latest('appointment_date')->limit(10)->with('doctor'),
        ];
        if (in_array($request->user()->role, ['admin', 'doctor'], true)) {
            $relations['visits'] = function ($q) use ($request): void {
                if ($request->user()->role === 'doctor') {
                    $q->where('doctor_id', Doctor::where('user_id', $request->user()->id)->value('id'));
                }
                $q->latest('visit_date')->limit(10)->with('doctor');
            };
        }

        return $this->ok($patient->loadCount('visits')->load($relations));
    }

    public function update(Request $request, Patient $patient): JsonResponse
    {
        // Reception edits demographics; only admin changes portal login and deletes.
        $this->requireRole($request, 'admin', 'receptionist');
        $data = $request->validate($this->rules(partial: true) + $this->loginRules());

        if (! empty($data['login_password']) || array_key_exists('login_phone', $data) || array_key_exists('login_active', $data)) {
            $this->requireRole($request, 'admin');
        }

        return DB::transaction(function () use ($request, $patient, $data) {
            if ($request->hasFile('avatar')) {
                Avatars::delete($patient->avatar_path);
                $data['avatar_path'] = Avatars::store($request->file('avatar'), 'avatars/patients');
            } elseif ($request->boolean('remove_avatar')) {
                Avatars::delete($patient->avatar_path);
                $data['avatar_path'] = null;
            }

            $loginChanges = $this->applyLoginChanges($patient, $data);

            $update = $this->patientFields($data);
            if (array_key_exists('avatar_path', $data)) {
                $update['avatar_path'] = $data['avatar_path'];
            }
            if (array_key_exists('user_id', $data)) {
                $update['user_id'] = $data['user_id'];
            }
            $patient->update($update);

            $this->audit($request, 'updated', 'patient', $patient->id, $loginChanges ?: 'Patient details updated.');

            return $this->ok($patient->fresh('user'));
        });
    }

    public function destroy(Request $request, Patient $patient): JsonResponse
    {
        $this->requireRole($request, 'admin');

        // Clinical and financial history must be preserved: soft delete only.
        abort_if($patient->visits()->exists() || $patient->invoices()->exists(), 422, 'Patients with visits or invoices cannot be deleted; they are preserved for records.');

        DB::transaction(function () use ($patient): void {
            // Disable the portal login too, so a deleted patient cannot keep signing in.
            $patient->user?->update(['is_active' => false]);
            $patient->user?->tokens()->delete();
            $patient->delete();
        });

        $this->audit($request, 'deleted', 'patient', $patient->id, 'Patient soft-deleted; portal login disabled.');

        return $this->ok(['message' => 'Patient deleted.']);
    }

    public function avatar(Request $request, Patient $patient): mixed
    {
        $this->authorizePatientAccess($request, $patient);

        return Avatars::respond($patient->avatar_path);
    }

    /** Portal: the signed-in patient's own record. The patient id is never taken from the request. */
    public function portalMe(Request $request): JsonResponse
    {
        return $this->ok($this->ownPatient($request)->loadCount('visits'));
    }

    /** A patient may change their own profile photo or password; clinical details stay with the front desk. */
    public function updatePortalMe(Request $request): JsonResponse
    {
        $patient = $this->ownPatient($request);
        $user = $request->user();
        $data = $request->validate([
            'avatar' => 'sometimes|nullable|image|max:2048|mimes:jpg,jpeg,png,webp',
            'remove_avatar' => 'sometimes|boolean',
            'current_password' => 'required_with:password|string',
            'password' => 'sometimes|string|min:8',
        ]);

        if (! empty($data['password'])) {
            abort_unless(Hash::check($data['current_password'], $user->password), 422, 'Current password does not match.');
            $user->update(['password' => $data['password']]);
            $this->audit($request, 'updated', 'user', $user->id, 'Patient changed their portal password.');
        }
        unset($data['current_password'], $data['password']);

        if ($request->hasFile('avatar')) {
            Avatars::delete($patient->avatar_path);
            $data['avatar_path'] = Avatars::store($request->file('avatar'), 'avatars/patients');
        } elseif ($request->boolean('remove_avatar')) {
            Avatars::delete($patient->avatar_path);
            $data['avatar_path'] = null;
        }
        unset($data['avatar'], $data['remove_avatar']);

        if ($data !== []) {
            $patient->update($data);
        }
        $this->audit($request, 'updated', 'patient', $patient->id, 'Patient updated their profile.');

        return $this->ok($patient->fresh()->loadCount('visits'));
    }

    public function portalVisits(Request $request): JsonResponse
    {
        $patient = $this->ownPatient($request);

        return $this->ok($patient->visits()->whereIn('status', ['finalized', 'amended'])->with(['doctor', 'prescriptions.items', 'amendments.user', 'amendments.doctor'])->latest('visit_date')->paginate(ListQuery::perPage($request)));
    }

    public function portalVisit(Request $request, Visit $visit): JsonResponse
    {
        $patient = $this->ownPatient($request);
        abort_unless($visit->patient_id === $patient->id, 403, 'You may only view your own visits.');
        abort_unless(in_array($visit->status, ['finalized', 'amended'], true), 403, 'This visit record is currently in draft.');

        return $this->ok($visit->load(['doctor', 'prescriptions.items', 'amendments.user', 'amendments.doctor']));
    }

    public function portalAppointments(Request $request): JsonResponse
    {
        $patient = $this->ownPatient($request);

        return $this->ok($patient->appointments()->with('doctor')->latest('appointment_date')->latest('start_time')->paginate(ListQuery::perPage($request)));
    }

    public function bookAppointment(Request $request): JsonResponse
    {
        $patient = $this->ownPatient($request);

        $data = $request->validate([
            'doctor_id' => 'required|exists:doctors,id',
            'appointment_date' => 'required|date|after_or_equal:today',
            'start_time' => 'required|date_format:H:i',
            'reason_for_visit' => 'nullable|string|max:255',
        ]);

        $doctor = Doctor::where('id', $data['doctor_id'])->where('is_active', true)->firstOrFail();
        $date = $data['appointment_date'];
        $startTime = $data['start_time'];

        $slotMinutes = (int) (ClinicSetting::value('appointment_slot_minutes') ?: 30);
        $endTime = Carbon::createFromFormat('H:i', $startTime)->addMinutes($slotMinutes)->format('H:i');

        return DB::transaction(function () use ($request, $patient, $doctor, $date, $startTime, $endTime, $data) {
            $conflict = Appointment::where('doctor_id', $doctor->id)
                ->whereDate('appointment_date', $date)
                ->whereNotIn('status', ['cancelled', 'no_show'])
                ->where(function ($query) use ($startTime, $endTime, $slotMinutes): void {
                    $query->where('start_time', '<', $endTime)
                        ->where(function ($end) use ($startTime, $slotMinutes): void {
                            $end->where(function ($q) use ($startTime): void {
                                $q->whereNotNull('end_time')->where('end_time', '>', $startTime);
                            })->orWhere(function ($q) use ($startTime, $slotMinutes): void {
                                $q->whereNull('end_time')->whereRaw("ADDTIME(start_time, SEC_TO_TIME(? * 60)) > ?", [$slotMinutes, $startTime]);
                            });
                        });
                })
                ->exists();

            abort_if($conflict, 422, 'The doctor already has an appointment scheduled at this time. Please select another slot.');

            $token = (int) Appointment::where('doctor_id', $doctor->id)
                ->whereDate('appointment_date', $date)
                ->lockForUpdate()
                ->max('token_number');

            $appointmentNumber = 'APT-'.now()->format('ymdHis').'-'.str()->upper(str()->random(4));

            $appointment = Appointment::create([
                'appointment_number' => $appointmentNumber,
                'patient_id' => $patient->id,
                'doctor_id' => $doctor->id,
                'appointment_date' => $date,
                'start_time' => $startTime,
                'end_time' => $endTime,
                'visit_type' => 'appointment',
                'token_number' => $token + 1,
                'status' => 'booked',
                'reason_for_visit' => $data['reason_for_visit'] ?? null,
                'created_by' => $request->user()->id,
            ]);

            $this->audit($request, 'created', 'appointment', $appointment->id, 'Patient booked appointment through portal.');

            $patientName = trim($patient->first_name.' '.($patient->last_name ?? ''));
            $when = $appointment->appointment_date?->format('d M Y').' at '.substr((string) $appointment->start_time, 0, 5);

            $notifications = app(ClinicNotifications::class);
            $notifications->notifyDoctor(
                $doctor,
                'New appointment booked',
                $patientName.' booked an appointment on '.$when.'.',
                'appointment.booked',
                'Appointments',
                $appointment->id
            );

            $notifications->notifyPatient(
                $patient,
                'Appointment confirmed',
                'Your appointment with Dr. '.$doctor->display_name.' is booked for '.$when.'.',
                'appointment.booked',
                'Appointments',
                $appointment->id
            );

            return $this->ok($appointment->load(['doctor', 'patient']), 201);
        });
    }

    public function cancelAppointment(Request $request, Appointment $appointment): JsonResponse
    {
        $patient = $this->ownPatient($request);
        abort_unless($appointment->patient_id === $patient->id, 403, 'You may only cancel your own appointments.');
        abort_if(in_array($appointment->status, ['cancelled', 'completed', 'no_show'], true), 422, 'This appointment cannot be cancelled.');

        $data = $request->validate([
            'reason' => 'nullable|string|max:255',
        ]);

        $reason = $data['reason'] ?? 'Cancelled by patient';
        $appointment->update([
            'status' => 'cancelled',
            'cancel_reason' => $reason,
        ]);

        $this->audit($request, 'cancelled', 'appointment', $appointment->id, 'Patient cancelled appointment: '.$reason);

        $patientName = trim($patient->first_name.' '.($patient->last_name ?? ''));
        $when = $appointment->appointment_date?->format('d M Y').' at '.substr((string) $appointment->start_time, 0, 5);

        $notifications = app(ClinicNotifications::class);
        $notifications->notifyDoctor(
            $appointment->doctor,
            'Appointment cancelled',
            $patientName.' cancelled their appointment on '.$when.'. Reason: '.$reason,
            'appointment.cancelled',
            'Appointments',
            $appointment->id
        );

        $notifications->notifyPatient(
            $patient,
            'Appointment cancelled',
            'Your appointment on '.$when.' was cancelled.',
            'appointment.cancelled',
            'Appointments',
            $appointment->id
        );

        return $this->ok($appointment->fresh(['doctor', 'patient']));
    }

    public function portalPrescriptions(Request $request): JsonResponse
    {
        $patient = $this->ownPatient($request);

        return $this->ok(
            $patient->prescriptions()
                ->where('status', 'finalized')
                ->with(['doctor', 'items', 'visit'])
                ->latest('issued_at')
                ->latest('id')
                ->paginate(ListQuery::perPage($request))
        );
    }

    public function portalPrescription(Request $request, Prescription $prescription): JsonResponse
    {
        $patient = $this->ownPatient($request);
        abort_unless($prescription->patient_id === $patient->id, 403, 'You may only view your own prescriptions.');
        abort_unless($prescription->status === 'finalized', 403, 'This prescription has not been finalized yet.');

        return $this->ok($prescription->load(['doctor', 'items', 'visit', 'patient']));
    }

    public function portalPrescriptionPrint(Request $request, Prescription $prescription): JsonResponse
    {
        $patient = $this->ownPatient($request);
        abort_unless($prescription->patient_id === $patient->id, 403, 'You may only print your own prescriptions.');
        abort_if($prescription->status !== 'finalized', 422, 'Only finalized prescriptions can be printed.');

        return $this->ok([
            'prescription' => $prescription->load(['items', 'patient', 'doctor', 'visit']),
            'clinic' => $this->clinicPrintPayload(),
            'printable' => true,
        ]);
    }

    public function portalInvoices(Request $request): JsonResponse
    {
        $patient = $this->ownPatient($request);

        return $this->ok(
            $patient->invoices()
                ->with(['items', 'payments', 'visit'])
                ->latest('invoice_date')
                ->latest('id')
                ->paginate(ListQuery::perPage($request))
        );
    }

    public function portalInvoice(Request $request, Invoice $invoice): JsonResponse
    {
        $patient = $this->ownPatient($request);
        abort_unless($invoice->patient_id === $patient->id, 403, 'You may only view your own bills.');

        return $this->ok($invoice->load(['items', 'payments', 'visit', 'patient']));
    }

    public function portalInvoiceReceipt(Request $request, Invoice $invoice): JsonResponse
    {
        $patient = $this->ownPatient($request);
        abort_unless($invoice->patient_id === $patient->id, 403, 'You may only print your own receipts.');

        return $this->ok([
            'invoice' => $invoice->load(['items', 'payments', 'visit', 'patient' => fn ($p) => $p->withTrashed()]),
            'clinic' => $this->clinicPrintPayload(),
        ]);
    }

    private function clinicPrintPayload(): ?array
    {
        $clinic = ClinicSetting::query()->first();

        if (! $clinic) {
            return null;
        }

        return $clinic->toArray() + ['logo_data_uri' => ClinicLogo::dataUri($clinic->logo_path)];
    }

    /** Admin-only: set a new portal password for a patient. Sessions are revoked. */
    public function resetLogin(Request $request, Patient $patient): JsonResponse
    {
        $this->requireRole($request, 'admin');
        $data = $request->validate(['password' => 'required|string|min:8']);
        abort_unless($patient->user, 422, 'This patient has no portal login. Create one first.');

        $patient->user->update(['password' => $data['password'], 'is_active' => true]);
        $patient->user->tokens()->delete();
        $this->audit($request, 'updated', 'patient', $patient->id, 'Portal password reset by admin; sessions revoked.');

        return $this->ok(['message' => 'Portal password reset.']);
    }

    private function ownPatient(Request $request): Patient
    {
        $user = $request->user();
        abort_unless($user->role === 'patient', 403, 'Patient portal only.');
        $patient = Patient::where('user_id', $user->id)->first();
        abort_unless($patient, 404, 'No patient record is linked to this login.');

        return $patient;
    }

    /** Access: admin/doctor/receptionist for any record, a patient only for their own. */
    private function authorizePatientAccess(Request $request, Patient $patient): void
    {
        $user = $request->user();
        if ($user->role === 'patient') {
            abort_unless($patient->user_id === $user->id, 403, 'You can only view your own record.');

            return;
        }
        $this->requireRole($request, 'admin', 'doctor', 'receptionist');
    }

    /** Patient-record fields. Login data is never written to the patient row. */
    private function patientFields(array $data): array
    {
        return collect($data)->only([
            'first_name', 'last_name', 'phone', 'email', 'date_of_birth', 'sex', 'address',
            'emergency_contact_name', 'emergency_contact_phone', 'allergies_summary', 'whatsapp_opt_in',
        ])->all();
    }

    /**
     * The sign-in phone: the explicit login phone if given, otherwise the patient's phone.
     * Normalized and unique among portal accounts.
     */
    private function loginPhoneFor(array $data, ?int $exceptUserId = null): string
    {
        $phone = Phone::normalize($data['login_phone'] ?? $data['phone'] ?? '');
        abort_if(strlen($phone) < 8, 422, 'A valid login phone number is required.');

        $taken = User::where('role', 'patient')
            ->where('phone', $phone)
            ->when($exceptUserId, fn ($q) => $q->where('id', '!=', $exceptUserId))
            ->lockForUpdate()
            ->exists();
        abort_if($taken, 422, 'Another patient already uses this phone number for portal sign-in.');

        return $phone;
    }

    private function makeLogin(array $data): User
    {
        $phone = $this->loginPhoneFor($data);

        return User::create([
            'name' => trim(($data['first_name'] ?? '').' '.($data['last_name'] ?? '')),
            // Internal account key only. Patients never sign in with it; they use the phone number.
            'email' => "patient{$phone}@portal.carehaven.local",
            'phone' => $phone,
            'password' => $data['login_password'],
            'role' => 'patient',
            'is_active' => true,
        ]);
    }

    /**
     * Creates or updates a patient's portal login. Returns an audit summary, or null when nothing changed.
     */
    private function applyLoginChanges(Patient $patient, array &$data): ?string
    {
        $summary = null;

        if (! $patient->user && ! empty($data['login_password'])) {
            $login = $this->makeLogin(array_merge($patient->toArray(), $data));
            $data['user_id'] = $login->id;
            $summary = 'Portal login created (sign-in by phone).';
        } elseif ($patient->user) {
            $updates = [];

            if (! empty($data['login_password'])) {
                $updates['password'] = $data['login_password'];
            }

            // Explicit login phone wins; otherwise a changed patient phone moves the sign-in with it.
            if (! empty($data['login_phone'])) {
                $newPhone = $this->loginPhoneFor(['login_phone' => $data['login_phone']], $patient->user->id);
            } elseif (array_key_exists('phone', $data) && Phone::normalize($data['phone']) !== $patient->user->phone) {
                $newPhone = $this->loginPhoneFor(['phone' => $data['phone']], $patient->user->id);
            }
            if (isset($newPhone) && $newPhone !== $patient->user->phone) {
                $updates['phone'] = $newPhone;
                $summary = 'Portal sign-in phone changed.';
            }

            if ($updates) {
                $patient->user->update($updates);
                if (isset($updates['password'])) {
                    $patient->user->tokens()->delete();
                }
                $summary = ($summary ? $summary.' ' : '').'Portal login updated.';
            }
        }

        if (array_key_exists('login_active', $data) && $patient->user) {
            $patient->user->update(['is_active' => (bool) $data['login_active']]);
            if (! $data['login_active']) {
                $patient->user->tokens()->delete();
            }
            $summary = ($summary ? $summary.' ' : '').'Portal access '.($data['login_active'] ? 'enabled' : 'disabled').'.';
        }

        unset($data['login_phone'], $data['login_password'], $data['login_active'], $data['avatar'], $data['remove_avatar']);

        return $summary;
    }

    private function loginRules(): array
    {
        return [
            'login_phone' => 'nullable|string|max:30',
            'login_password' => 'nullable|string|min:8',
            'login_active' => 'sometimes|boolean',
        ];
    }

    private function rules(bool $partial = false): array
    {
        $req = $partial ? 'sometimes' : 'required';

        return [
            'first_name' => "{$req}|string|max:100",
            'last_name' => 'nullable|string|max:100',
            'phone' => "{$req}|string|max:30",
            'email' => 'nullable|email|max:190',
            'date_of_birth' => 'nullable|date|before:today',
            'sex' => 'nullable|in:male,female,other,prefer_not_to_say',
            'address' => 'nullable|string|max:500',
            'emergency_contact_name' => 'nullable|string|max:100',
            'emergency_contact_phone' => 'nullable|string|max:30',
            'allergies_summary' => 'nullable|string|max:500',
            'whatsapp_opt_in' => 'sometimes|boolean',
            'avatar' => 'sometimes|nullable|image|max:2048|mimes:jpg,jpeg,png,webp',
            'remove_avatar' => 'sometimes|boolean',
        ];
    }
}
