<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\AuditLog;
use App\Models\ClinicSetting;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\Payment;
use App\Models\Prescription;
use App\Models\User;
use App\Models\Visit;
use App\Support\Avatars;
use App\Support\ClinicLogo;
use App\Support\ClinicNotifications;
use App\Support\ListQuery;
use App\Support\Phone;
use App\Support\WhatsAppDispatcher;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class ApiController extends Controller
{
    private function number(string $prefix): string
    {
        return $prefix.'-'.now()->format('ymdHis').'-'.str()->upper(str()->random(4));
    }

    private function ok(mixed $data, int $status = 200): mixed
    {
        return response()->json(['data' => $data], $status);
    }

    private function audit(Request $request, string $action, string $entityType, ?int $entityId, string $summary): void
    {
        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'summary' => $summary,
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'created_at' => now(),
        ]);
    }

    private function canAccessDoctor(Request $request, Doctor $doctor): bool
    {
        return $request->user()->role === 'admin' || ($request->user()->role === 'doctor' && $doctor->user_id === $request->user()->id);
    }

    private function refreshInvoiceStatus(Invoice $invoice): void
    {
        $paid = (float) $invoice->paid_amount;
        $total = (float) $invoice->total_amount;
        $invoice->update(['status' => $paid <= 0 ? 'unpaid' : ($paid >= $total ? 'paid' : 'partially_paid')]);
    }

    private function hasAppointmentConflict(Appointment $appointment, int $doctorId, string $date, string $startTime, ?string $endTime): bool
    {
        $slotMinutes = (int) (ClinicSetting::value('appointment_slot_minutes') ?: 30);
        $computedEnd = $endTime ?: Carbon::createFromFormat('H:i', substr($startTime, 0, 5))->addMinutes($slotMinutes)->format('H:i');

        return Appointment::query()
            ->where('doctor_id', $doctorId)
            ->whereDate('appointment_date', $date)
            ->where('id', '!=', $appointment->id)
            ->whereNotIn('status', ['cancelled', 'no_show'])
            ->where('start_time', '<', $computedEnd)
            ->where(function ($query) use ($startTime, $slotMinutes): void {
                $query->where(function ($q) use ($startTime): void {
                    $q->whereNotNull('end_time')->where('end_time', '>', $startTime);
                })->orWhere(function ($q) use ($startTime, $slotMinutes): void {
                    $q->whereNull('end_time')->whereRaw("ADDTIME(start_time, SEC_TO_TIME(? * 60)) > ?", [$slotMinutes, $startTime]);
                });
            })
            ->exists();
    }

    private function csv(string $filename, array $headers, iterable $rows): mixed
    {
        return response()->streamDownload(function () use ($headers, $rows): void {
            $output = fopen('php://output', 'wb');
            fputcsv($output, $headers);
            foreach ($rows as $row) {
                fputcsv($output, $row);
            }
            fclose($output);
        }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    public function login(Request $request): mixed
    {
        $data = $request->validate([
            'login' => 'required_without:email|string|max:190',
            'email' => 'required_without:login|string|max:190',
            'password' => 'required|string',
        ]);
        $user = $this->findLoginAccount((string) ($data['login'] ?? $data['email']));
        abort_unless($user && $user->is_active && Hash::check($data['password'], $user->password), 422, 'Invalid credentials.');
        $user->update(['last_login_at' => now()]);

        return $this->ok(['user' => $user, 'token' => $user->createToken('clinic-api')->plainTextToken]);
    }

    /**
     * Staff sign in with email. Patients sign in with their registered phone number.
     * A phone identifier never matches a staff account, and an email never matches a patient phone.
     */
    private function findLoginAccount(string $identifier): ?User
    {
        $identifier = trim($identifier);
        if (filter_var($identifier, FILTER_VALIDATE_EMAIL)) {
            return User::where('email', $identifier)->where('role', '!=', 'patient')->first();
        }

        $phone = Phone::normalize($identifier);
        if (strlen($phone) < 8) {
            return null;
        }

        return User::where('role', 'patient')->where('phone', $phone)->first();
    }

    public function logout(Request $request): mixed
    {
        $request->user()->currentAccessToken()?->delete();

        return $this->ok(['message' => 'Logged out']);
    }

    public function me(Request $request): mixed
    {
        return $this->ok($request->user());
    }

    /**
     * Staff update their own profile: display name, phone and profile photo.
     * Roles, status and the doctor record stay under admin control.
     */
    public function updateMe(Request $request): mixed
    {
        $user = $request->user();
        abort_unless(in_array($user->role, ['admin', 'doctor', 'receptionist'], true), 403, 'Patient accounts use the patient portal.');

        $data = $request->validate([
            'name' => 'sometimes|string|max:100',
            'phone' => 'sometimes|nullable|string|max:30',
            'avatar' => 'sometimes|nullable|image|max:2048|mimes:jpg,jpeg,png,webp',
            'remove_avatar' => 'sometimes|boolean',
            'current_password' => 'required_with:password|string',
            'password' => 'sometimes|string|min:8',
        ]);

        if (! empty($data['password'])) {
            abort_unless(Hash::check($data['current_password'], $user->password), 422, 'Current password does not match.');
        }
        unset($data['current_password']);

        if ($request->hasFile('avatar')) {
            Avatars::delete($user->avatar_path);
            $data['avatar_path'] = Avatars::store($request->file('avatar'), 'avatars/users');
        } elseif ($request->boolean('remove_avatar')) {
            Avatars::delete($user->avatar_path);
            $data['avatar_path'] = null;
        }
        unset($data['avatar'], $data['remove_avatar']);

        if ($data !== []) {
            $user->update($data);
        }
        $this->audit($request, 'updated', 'user', $user->id, 'User updated their own profile.');

        return $this->ok($user->fresh());
    }

    public function patientVisits(Request $r, Patient $patient): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor']);
        $query = $patient->visits()->with(['doctor', 'prescriptions.items', 'amendments.user', 'amendments.doctor']);
        if ($r->user()->role === 'doctor') {
            $query->where('doctor_id', Doctor::where('user_id', $r->user()->id)->value('id'));
        }

        return $this->ok($query->latest('visit_date')->paginate(min(100, max(1, $r->integer('per_page', 20)))));
    }

    public function patientAppointments(Request $r, Patient $patient): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist']);
        $query = $patient->appointments()->with('doctor');
        if ($r->user()->role === 'doctor') {
            $query->where('doctor_id', Doctor::where('user_id', $r->user()->id)->value('id'));
        }

        return $this->ok($query->latest('appointment_date')->paginate(min(100, max(1, $r->integer('per_page', 20)))));
    }

    public function storeAppointment(Request $r): mixed
    {
        return $this->appointment($r, false);
    }

    public function walkIn(Request $r): mixed
    {
        return $this->appointment($r, true);
    }

    private function appointment(Request $r, bool $walkIn): mixed
    {
        $d = $r->validate(['patient_id' => 'required|exists:patients,id', 'doctor_id' => 'required|exists:doctors,id', 'appointment_date' => 'nullable|date', 'start_time' => 'nullable|date_format:H:i', 'end_time' => 'nullable|date_format:H:i|after:start_time', 'reason_for_visit' => 'nullable|string|max:255']);
        $date = $d['appointment_date'] ?? today()->toDateString();
        $startTime = $d['start_time'] ?? now()->format('H:i');

        $now = now();
        $today = $now->toDateString();
        $cutoff = $now->copy()->subMinutes(2)->format('H:i');

        if ($date === $today) {
            abort_if($startTime < $cutoff, 422, 'Cannot schedule an appointment or walk-in for a past time today (current clinic time is '.$now->format('H:i').').');
        } elseif ($date < $today) {
            abort(422, 'Cannot schedule an appointment in the past.');
        }

        return DB::transaction(function () use ($r, $d, $date, $walkIn, $startTime) {
            $doctor = Doctor::findOrFail($d['doctor_id']);
            $slotMinutes = (int) (ClinicSetting::value('appointment_slot_minutes') ?: 30);
            $endTime = $d['end_time'] ?? Carbon::createFromFormat('H:i', substr($startTime, 0, 5))->addMinutes($slotMinutes)->format('H:i');
            abort_if(Appointment::where('doctor_id', $doctor->id)
                ->whereDate('appointment_date', $date)
                ->whereNotIn('status', ['cancelled', 'no_show'])
                ->where('start_time', '<', $endTime)
                ->where(function ($query) use ($startTime, $slotMinutes): void {
                    $query->where(function ($q) use ($startTime): void {
                        $q->whereNotNull('end_time')->where('end_time', '>', $startTime);
                    })->orWhere(function ($q) use ($startTime, $slotMinutes): void {
                        $q->whereNull('end_time')->whereRaw("ADDTIME(start_time, SEC_TO_TIME(? * 60)) > ?", [$slotMinutes, $startTime]);
                    });
                })->exists() && ! $walkIn, 422, 'The doctor already has an appointment in this time range.');
            $token = Appointment::where('doctor_id', $doctor->id)->whereDate('appointment_date', $date)->lockForUpdate()->max('token_number');
            $a = Appointment::create(['appointment_number' => $this->number('APT'), 'patient_id' => $d['patient_id'], 'doctor_id' => $doctor->id, 'appointment_date' => $date, 'start_time' => $startTime, 'end_time' => $endTime, 'visit_type' => $walkIn ? 'walk_in' : 'appointment', 'token_number' => $token + 1, 'status' => $walkIn ? 'waiting' : 'booked', 'reason_for_visit' => $d['reason_for_visit'] ?? null, 'created_by' => $r->user()->id]);
            $this->audit($r, 'created', 'appointment', $a->id, $walkIn ? 'Walk-in registered.' : 'Appointment booked.');
            $this->notifyAboutAppointment($a, $walkIn ? 'appointment.walk_in' : 'appointment.booked');

            return $this->ok($a->load(['patient', 'doctor']), 201);
        });
    }

    /**
     * Tell the assigned doctor and the patient about a new, changed, or cancelled appointment.
     */
    private function notifyAboutAppointment(Appointment $appointment, string $type, ?string $reason = null): void
    {
        $patient = $appointment->patient;
        $patientName = $patient ? trim(($patient->first_name ?? '').' '.($patient->last_name ?? '')) : 'A patient';
        $when = $appointment->appointment_date->format('d M Y').' at '.$appointment->start_time;
        $notifications = $this->notifications();

        match ($type) {
            'appointment.cancelled' => [
                $notifications->notifyDoctor($appointment->doctor, 'Appointment cancelled', $patientName.'\'s appointment on '.$when.' was cancelled. '.($reason ? 'Reason: '.$reason : ''), $type, 'Appointments', $appointment->id),
                $notifications->notifyPatient($appointment->patient, 'Your appointment was cancelled', 'Your appointment on '.$when.' was cancelled. '.($reason ? 'Reason: '.$reason : ''), $type, 'Appointments', $appointment->id),
            ],
            'appointment.rescheduled' => [
                $notifications->notifyDoctor($appointment->doctor, 'Appointment rescheduled', $patientName.'\'s appointment moved to '.$when.'.', $type, 'Appointments', $appointment->id),
                $notifications->notifyPatient($appointment->patient, 'Your appointment was rescheduled', 'Your appointment is now on '.$when.'.', $type, 'Appointments', $appointment->id),
            ],
            default => [
                $notifications->notifyDoctor($appointment->doctor, 'New appointment booked', $patientName.' is scheduled on '.$when.'.', $type, 'Appointments', $appointment->id),
                $notifications->notifyPatient($appointment->patient, 'Appointment confirmed', 'Your appointment is booked for '.$when.'.', $type, 'Appointments', $appointment->id),
            ],
        };

        $this->sendWhatsapp($appointment, match ($type) {
            'appointment.cancelled' => 'appointment_cancelled',
            'appointment.rescheduled' => 'appointment_rescheduled',
            default => 'appointment_confirmation',
        }, $reason ? ['reason' => $reason] : []);
    }

    /**
     * Queue a WhatsApp message for a patient, when reminders are enabled and the patient opted in.
     */
    private function sendWhatsapp(Appointment $appointment, string $event, array $extra = []): void
    {
        if (! config('whatsapp.enabled')) {
            return;
        }

        $patient = $appointment->patient;
        if (! $patient) {
            return;
        }

        $dispatcher = app(WhatsAppDispatcher::class);
        $values = $dispatcher->values($patient, $appointment, $extra);
        $dispatcher->send($patient, $event, $values, $appointment);
    }

    public function appointments(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist']);
        $q = Appointment::with(['patient', 'doctor'])
            ->when($r->string('date')->toString() !== 'all', fn ($q) => $q->whereDate('appointment_date', $r->string('date')->toString() ?: today()->toDateString()))
            ->when($r->filled('date_from') || $r->filled('date_to'), fn ($q) => $q->whereBetween('appointment_date', [$r->string('date_from')->toString() ?: '1970-01-01', $r->string('date_to')->toString() ?: '2999-12-31']))
            ->when($r->filled('status'), fn ($q) => $q->where('status', $r->string('status')->toString()))
            ->when($r->filled('doctor_id'), fn ($q) => $q->where('doctor_id', $r->integer('doctor_id')))
            ->when($r->filled('visit_type'), fn ($q) => $q->where('visit_type', $r->string('visit_type')->toString()))
            ->when($r->filled('search'), function ($q) use ($r) {
                $term = '%'.addcslashes($r->string('search')->toString(), '%_\\').'%';
                $q->where(fn ($w) => $w->where('appointment_number', 'like', $term)
                    ->orWhere('reason_for_visit', 'like', $term)
                    ->orWhereHas('patient', fn ($p) => $p->where('first_name', 'like', $term)->orWhere('last_name', 'like', $term)->orWhere('patient_number', 'like', $term)));
            });
        if ($r->user()->role === 'doctor') {
            $q->where('doctor_id', Doctor::where('user_id', $r->user()->id)->value('id'));
        }

        $sortable = ['appointment_date', 'start_time', 'token_number', 'status', 'created_at'];
        $field = in_array($r->string('sort')->toString(), $sortable, true) ? $r->string('sort')->toString() : 'token_number';
        $direction = $r->string('direction')->lower()->toString() === 'desc' ? 'desc' : 'asc';

        return $this->ok($q->orderBy($field, $direction)->orderBy('id')->paginate(min(100, max(1, $r->integer('per_page', 25)))));
    }

    public function showAppointment(Request $r, Appointment $appointment): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist']);
        if ($r->user()->role === 'doctor') {
            abort_unless($appointment->doctor?->user_id === $r->user()->id, 403, 'You may only view assigned appointments.');
        }

        return $this->ok($appointment->load(['patient', 'doctor', 'visit']));
    }

    public function updateAppointment(Request $r, Appointment $appointment): mixed
    {
        abort_if(in_array($appointment->status, ['completed', 'cancelled', 'no_show'], true), 422, 'This appointment can no longer be rescheduled.');
        $d = $r->validate(['doctor_id' => 'sometimes|exists:doctors,id', 'appointment_date' => 'sometimes|date', 'start_time' => 'sometimes|date_format:H:i', 'end_time' => 'nullable|date_format:H:i|after:start_time', 'reason_for_visit' => 'nullable|string|max:255']);
        $doctorId = (int) ($d['doctor_id'] ?? $appointment->doctor_id);
        $date = (string) ($d['appointment_date'] ?? $appointment->appointment_date->toDateString());
        $startTime = (string) ($d['start_time'] ?? $appointment->start_time);
        $endTime = array_key_exists('end_time', $d) ? $d['end_time'] : $appointment->end_time;

        $now = now();
        $today = $now->toDateString();
        $cutoff = $now->copy()->subMinutes(2)->format('H:i');
        if ($date === $today) {
            abort_if($startTime < $cutoff, 422, 'Cannot reschedule an appointment to a past time today (current clinic time is '.$now->format('H:i').').');
        } elseif ($date < $today) {
            abort(422, 'Cannot reschedule an appointment to a past date.');
        }

        abort_if($this->hasAppointmentConflict($appointment, $doctorId, $date, $startTime, $endTime), 422, 'The doctor already has an appointment in this time range.');
        $appointment->update($d);
        $this->audit($r, 'updated', 'appointment', $appointment->id, 'Appointment rescheduled or updated.');
        $this->notifyAboutAppointment($appointment->fresh(['patient', 'doctor']), 'appointment.rescheduled');

        return $this->ok($appointment->fresh(['patient', 'doctor']));
    }

    public function cancelAppointment(Request $r, Appointment $appointment): mixed
    {
        abort_if(in_array($appointment->status, ['completed', 'cancelled', 'no_show'], true), 422, 'This appointment cannot be cancelled.');
        $d = $r->validate(['cancel_reason' => 'required|string|max:255']);
        $appointment->update(['status' => 'cancelled', 'cancel_reason' => $d['cancel_reason']]);
        $this->audit($r, 'cancelled', 'appointment', $appointment->id, 'Appointment cancelled.');
        $this->notifyAboutAppointment($appointment->load(['patient', 'doctor']), 'appointment.cancelled', $d['cancel_reason']);

        return $this->ok($appointment);
    }

    public function appointmentStatus(Request $r, Appointment $appointment): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist']);
        abort_unless($r->user()->role !== 'doctor' || $appointment->doctor?->user_id === $r->user()->id, 403, 'Doctors may only update their assigned appointments.');
        $d = $r->validate(['status' => 'required|in:booked,waiting,in_consultation,completed,cancelled,no_show', 'cancel_reason' => 'nullable|string']);
        $allowed = ['booked' => ['waiting', 'cancelled', 'no_show'], 'waiting' => ['in_consultation', 'cancelled', 'no_show'], 'in_consultation' => ['completed'], 'completed' => [], 'cancelled' => [], 'no_show' => []];
        abort_unless(in_array($d['status'], $allowed[$appointment->status] ?? [], true), 422, 'Invalid status transition.');
        $appointment->update($d);
        $this->audit($r, 'status_changed', 'appointment', $appointment->id, 'Appointment status changed.');

        return $this->ok($appointment);
    }

    public function listDoctors(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist', 'patient']);
        $q = Doctor::query()->with('user')
            ->when($r->filled('active'), fn ($q) => $q->where('is_active', $r->boolean('active')), fn ($q) => $q->where('is_active', true))
            ->when($r->filled('specialization'), fn ($q) => $q->where('specialization', $r->string('specialization')->toString()))
            ->when($r->filled('search'), function ($q) use ($r) {
                $term = '%'.addcslashes($r->string('search')->toString(), '%_\\').'%';
                $q->where(fn ($w) => $w->where('display_name', 'like', $term)->orWhere('specialization', 'like', $term));
            });
        $sortable = ['display_name', 'specialization', 'consultation_fee'];
        $field = in_array($r->string('sort')->toString(), $sortable, true) ? $r->string('sort')->toString() : 'display_name';
        $direction = $r->string('direction')->lower()->toString() === 'desc' ? 'desc' : 'asc';

        if ($r->boolean('all')) {
            return $this->ok($q->orderBy($field, $direction)->get());
        }

        return $this->ok($q->orderBy($field, $direction)->paginate(min(100, max(1, $r->integer('per_page', 20)))));
    }

    public function showDoctor(Request $r, Doctor $doctor): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist', 'patient']);

        return $this->ok($doctor->load(['user', 'schedules']));
    }

    public function doctorAvailability(Request $r, Doctor $doctor): mixed
    {
        $date = Carbon::parse($r->query('date', today()->toDateString()));

        return $this->ok([
            'date' => $date->toDateString(),
            'day_of_week' => $date->dayOfWeek,
            'current_time' => now()->format('H:i'),
            'schedules' => $doctor->schedules()->where('day_of_week', $date->dayOfWeek)->where('is_active', true)->get(),
            'appointments' => $doctor->appointments()->whereDate('appointment_date', $date)->whereNotIn('status', ['cancelled', 'no_show'])->orderBy('start_time')->get(),
        ]);
    }

    public function doctorSchedules(Doctor $doctor): mixed
    {
        return $this->ok($doctor->schedules()->orderBy('day_of_week')->orderBy('start_time')->get());
    }

    public function storeDoctorSchedule(Request $r, Doctor $doctor): mixed
    {
        $data = $r->validate(['day_of_week' => 'required|integer|between:0,6', 'start_time' => 'required|date_format:H:i', 'end_time' => 'required|date_format:H:i|after:start_time', 'is_active' => 'sometimes|boolean']);
        $schedule = $doctor->schedules()->create($data);
        $this->audit($r, 'created', 'doctor_schedule', $schedule->id, 'Doctor schedule created.');

        return $this->ok($schedule, 201);
    }

    public function updateDoctorSchedule(Request $r, DoctorSchedule $schedule): mixed
    {
        $data = $r->validate(['day_of_week' => 'sometimes|integer|between:0,6', 'start_time' => 'sometimes|date_format:H:i', 'end_time' => 'sometimes|date_format:H:i|after:start_time', 'is_active' => 'sometimes|boolean']);
        $schedule->update($data);
        $this->audit($r, 'updated', 'doctor_schedule', $schedule->id, 'Doctor schedule updated.');

        return $this->ok($schedule);
    }

    public function deleteDoctorSchedule(Request $r, DoctorSchedule $schedule): mixed
    {
        $id = $schedule->id;
        $schedule->delete();
        $this->audit($r, 'deleted', 'doctor_schedule', $id, 'Doctor schedule deleted.');

        return $this->ok(['message' => 'Schedule deleted.']);
    }

    public function listVisits(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist']);
        $q = Visit::with(['patient', 'doctor', 'amendments.user', 'amendments.doctor'])
            ->when($r->filled('status'), fn ($q) => $q->where('status', $r->string('status')->toString()))
            ->when($r->filled('doctor_id'), fn ($q) => $q->where('doctor_id', $r->integer('doctor_id')))
            ->when($r->filled('patient_id'), fn ($q) => $q->where('patient_id', $r->integer('patient_id')))
            ->when($r->filled('date_from'), fn ($q) => $q->whereDate('visit_date', '>=', $r->string('date_from')->toString()))
            ->when($r->filled('date_to'), fn ($q) => $q->whereDate('visit_date', '<=', $r->string('date_to')->toString()))
            ->when($r->filled('search'), function ($q) use ($r) {
                $term = '%'.addcslashes($r->string('search')->toString(), '%_\\').'%';
                $q->where(fn ($w) => $w->where('visit_number', 'like', $term)->orWhere('diagnosis', 'like', $term)
                    ->orWhereHas('patient', fn ($p) => $p->where('first_name', 'like', $term)->orWhere('patient_number', 'like', $term)));
            });
        if ($r->user()->role === 'doctor') {
            $q->where('doctor_id', Doctor::where('user_id', $r->user()->id)->value('id'));
        }
        $sortable = ['visit_date', 'visit_number', 'status', 'created_at'];
        $field = in_array($r->string('sort')->toString(), $sortable, true) ? $r->string('sort')->toString() : 'visit_date';
        $direction = $r->string('direction')->lower()->toString() === 'asc' ? 'asc' : 'desc';

        return $this->ok($q->orderBy($field, $direction)->orderBy('id', 'desc')->paginate(min(100, max(1, $r->integer('per_page', 20)))));
    }

    public function storeVisit(Request $r): mixed
    {
        $d = $r->validate(['patient_id' => 'required|exists:patients,id', 'doctor_id' => 'required|exists:doctors,id', 'appointment_id' => 'nullable|exists:appointments,id', 'visit_date' => 'nullable|date', 'symptoms' => 'nullable|string', 'vitals' => 'nullable|array', 'examination_notes' => 'nullable|string', 'diagnosis' => 'nullable|string', 'treatment_plan' => 'nullable|string', 'follow_up_date' => 'nullable|date']);
        $doctor = Doctor::findOrFail($d['doctor_id']);
        abort_unless($r->user()->role === 'admin' || ($r->user()->role === 'doctor' && $doctor->user_id === $r->user()->id), 403, 'You may only create visits for an assigned doctor.');
        if (! empty($d['appointment_id'])) {
            $appointment = Appointment::findOrFail($d['appointment_id']);
            abort_unless($appointment->patient_id === (int) $d['patient_id'] && $appointment->doctor_id === $doctor->id, 422, 'Appointment does not match the visit.');
            $appointment->update(['status' => 'in_consultation']);
        }
        $d['visit_number'] = $this->number('VIS');
        $d['visit_date'] = $d['visit_date'] ?? today();
        $d['created_by'] = $r->user()->id;
        $visit = Visit::create($d);
        $this->audit($r, 'created', 'visit', $visit->id, 'Consultation started.');

        return $this->ok($visit->fresh(['patient', 'doctor', 'prescriptions.items', 'amendments.user', 'amendments.doctor']), 201);
    }

    public function showVisit(Request $r, Visit $visit): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist']);
        if ($r->user()->role === 'doctor') {
            abort_unless($visit->doctor?->user_id === $r->user()->id, 403, 'You may only view your own consultations.');
        }

        return $this->ok($visit->load(['patient', 'doctor', 'prescriptions.items', 'amendments.user', 'amendments.doctor', 'invoices']));
    }

    public function updateVisit(Request $r, Visit $visit): mixed
    {
        abort_if(in_array($visit->status, ['finalized', 'amended'], true), 422, 'Finalized or amended visits cannot be edited directly. Use amendments to record clinical addenda.');
        abort_unless($r->user()->role === 'admin' || ($r->user()->role === 'doctor' && $visit->doctor?->user_id === $r->user()->id), 403, 'You may only edit your own consultations.');
        $visit->update($r->validate(['symptoms' => 'nullable|string', 'vitals' => 'nullable|array', 'examination_notes' => 'nullable|string', 'diagnosis' => 'nullable|string', 'treatment_plan' => 'nullable|string', 'follow_up_date' => 'nullable|date']));
        $this->audit($r, 'updated', 'visit', $visit->id, 'Consultation draft updated.');

        return $this->ok($visit);
    }

    public function finalizeVisit(Request $r, Visit $visit): mixed
    {
        abort_if(in_array($visit->status, ['finalized', 'amended'], true), 422, 'Already finalized.');
        abort_unless($r->user()->role === 'admin' || ($r->user()->role === 'doctor' && $visit->doctor?->user_id === $r->user()->id), 403, 'You may only finalize your own consultations.');
        $visit->update(['status' => 'finalized', 'finalized_at' => now()]);
        if ($visit->appointment_id) {
            $visit->appointment?->update(['status' => 'completed']);
        }
        $this->audit($r, 'finalized', 'visit', $visit->id, 'Consultation finalized.');
        $this->notifyAboutFinalizedVisit($visit);

        return $this->ok($visit);
    }

    private function notifyAboutFinalizedVisit(Visit $visit): void
    {
        $notifications = $this->notifications();
        $patient = $visit->patient;
        $patientName = $patient ? trim(($patient->first_name ?? '').' '.($patient->last_name ?? '')) : 'Your';
        $doctorName = $visit->doctor?->display_name ?? 'your doctor';

        $notifications->notifyPatient($visit->patient, 'Your consultation is complete', $doctorName.' has finalised your visit notes. '.($visit->diagnosis ? 'Diagnosis: '.$visit->diagnosis : ''), 'visit.finalized', 'Visits', $visit->id);
        $notifications->notifyRoles(['admin', 'receptionist'], 'Consultation finalised', $patientName.' completed a consultation with '.$doctorName.'.', 'visit.finalized', 'Consultation', $visit->id);
    }

    public function amendVisit(Request $r, Visit $visit): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor']);
        abort_unless(in_array($visit->status, ['finalized', 'amended'], true), 422, 'Only finalized consultations can be amended. Drafts can be edited directly.');
        abort_unless($r->user()->role === 'admin' || ($r->user()->role === 'doctor' && $visit->doctor?->user_id === $r->user()->id), 403, 'You may only amend your own consultations.');
        $d = $r->validate(['reason' => 'required|string|max:150', 'notes' => 'required|string|max:5000']);
        $doctor = $r->user()->role === 'doctor' ? Doctor::where('user_id', $r->user()->id)->first() : $visit->doctor;

        return DB::transaction(function () use ($r, $visit, $d, $doctor) {
            $amendment = $visit->amendments()->create([
                'user_id' => $r->user()->id,
                'doctor_id' => $doctor?->id,
                'reason' => $d['reason'],
                'notes' => $d['notes'],
            ]);
            $visit->update(['status' => 'amended']);
            $this->audit($r, 'amended', 'visit', $visit->id, 'Consultation amended: '.$d['reason']);

            return $this->ok($amendment->load(['user', 'doctor']), 201);
        });
    }

    public function storePrescription(Request $r, Visit $visit): mixed
    {
        abort_if($visit->status === 'finalized' && $visit->prescriptions()->where('status', 'finalized')->exists(), 422, 'A finalized prescription already exists for this visit.');
        abort_unless($r->user()->role === 'admin' || ($r->user()->role === 'doctor' && $visit->doctor?->user_id === $r->user()->id), 403, 'You may only prescribe for your own consultations.');
        $d = $r->validate(['instructions' => 'nullable|string', 'items' => 'required|array|min:1', 'items.*.medicine_name' => 'required|string', 'items.*.strength' => 'nullable|string', 'items.*.dosage' => 'required|string', 'items.*.route' => 'nullable|string', 'items.*.frequency' => 'required|string', 'items.*.duration' => 'required|string', 'items.*.quantity' => 'nullable|integer|min:1', 'items.*.instructions' => 'nullable|string']);

        return DB::transaction(function () use ($d, $r, $visit) {
            $p = Prescription::create(['prescription_number' => $this->number('RX'), 'visit_id' => $visit->id, 'patient_id' => $visit->patient_id, 'doctor_id' => $visit->doctor_id, 'instructions' => $d['instructions'] ?? null]);
            $p->items()->createMany(array_map(fn ($i) => $i + ['sort_order' => 0], $d['items']));
            $this->audit($r, 'created', 'prescription', $p->id, 'Prescription draft created.');

            return $this->ok($p->load('items'), 201);
        });
    }

    public function listPrescriptions(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor']);
        $q = Prescription::query()->with(['items', 'patient', 'doctor', 'visit'])
            ->when($r->filled('status'), fn ($q) => $q->where('status', $r->string('status')->toString()))
            ->when($r->filled('patient_id'), fn ($q) => $q->where('patient_id', $r->integer('patient_id')))
            ->when($r->filled('doctor_id'), fn ($q) => $q->where('doctor_id', $r->integer('doctor_id')))
            ->when($r->filled('date_from'), fn ($q) => $q->whereDate('created_at', '>=', $r->string('date_from')->toString()))
            ->when($r->filled('date_to'), fn ($q) => $q->whereDate('created_at', '<=', $r->string('date_to')->toString()))
            ->when($r->filled('search'), function ($q) use ($r) {
                $term = '%'.addcslashes($r->string('search')->toString(), '%_\\').'%';
                $q->where(fn ($w) => $w->where('prescription_number', 'like', $term)
                    ->orWhereHas('patient', fn ($p) => $p->where('first_name', 'like', $term)->orWhere('last_name', 'like', $term)->orWhere('patient_number', 'like', $term))
                    ->orWhereHas('items', fn ($i) => $i->where('medicine_name', 'like', $term)));
            });
        if ($r->user()->role === 'doctor') {
            $q->where('doctor_id', Doctor::where('user_id', $r->user()->id)->value('id'));
        }
        $sort = in_array($r->string('sort')->toString(), ['created_at', 'issued_at', 'prescription_number', 'status'], true)
            ? $r->string('sort')->toString()
            : 'created_at';
        $direction = $r->string('direction')->lower()->toString() === 'asc' ? 'asc' : 'desc';

        return $this->ok($q->orderBy($sort, $direction)->orderBy('id', 'desc')->paginate(min(100, max(1, $r->integer('per_page', 20)))));
    }

    public function showPrescription(Request $r, Prescription $prescription): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor']);
        if ($r->user()->role === 'doctor') {
            abort_unless($prescription->doctor?->user_id === $r->user()->id, 403, 'You may only view your own prescriptions.');
        }

        return $this->ok($prescription->load(['items', 'patient', 'doctor', 'visit']));
    }

    public function updatePrescription(Request $r, Prescription $prescription): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor']);
        abort_if($prescription->status !== 'draft', 422, 'Only draft prescriptions can be changed.');
        if ($r->user()->role === 'doctor') {
            abort_unless($prescription->doctor?->user_id === $r->user()->id, 403, 'You may only edit your own prescriptions.');
        }
        $d = $r->validate([
            'instructions' => 'sometimes|nullable|string',
            'items' => 'sometimes|array|min:1',
            'items.*.medicine_name' => 'required_with:items|string|max:200',
            'items.*.strength' => 'nullable|string|max:100',
            'items.*.dosage' => 'required_with:items|string|max:100',
            'items.*.route' => 'nullable|string|max:100',
            'items.*.frequency' => 'required_with:items|string|max:100',
            'items.*.duration' => 'required_with:items|string|max:100',
            'items.*.quantity' => 'nullable|integer|min:1',
            'items.*.instructions' => 'nullable|string|max:500',
        ]);

        DB::transaction(function () use ($d, $r, $prescription): void {
            if (array_key_exists('instructions', $d)) {
                $prescription->update(['instructions' => $d['instructions']]);
            }
            if (array_key_exists('items', $d)) {
                $prescription->items()->get()->each->delete();
                $prescription->items()->createMany(array_map(
                    fn (array $item, int $index) => $item + ['sort_order' => $index],
                    $d['items'],
                    array_keys($d['items']),
                ));
            }
            $this->audit($r, 'updated', 'prescription', $prescription->id, 'Draft prescription updated.');
        });

        return $this->ok($prescription->fresh(['items', 'patient', 'doctor', 'visit']));
    }

    public function deletePrescription(Request $r, Prescription $prescription): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor']);
        abort_if($prescription->status !== 'draft', 422, 'Only draft prescriptions can be deleted.');
        if ($r->user()->role === 'doctor') {
            abort_unless($prescription->doctor?->user_id === $r->user()->id, 403, 'You may only delete your own prescriptions.');
        }
        $id = $prescription->id;
        $prescription->delete();
        $this->audit($r, 'deleted', 'prescription', $id, 'Draft prescription deleted.');

        return $this->ok(['message' => 'Draft prescription deleted.']);
    }

    public function finalizePrescription(Request $r, Prescription $prescription): mixed
    {
        abort_if($prescription->status === 'finalized', 422, 'Prescription is already finalized.');
        abort_unless($r->user()->role === 'admin' || ($r->user()->role === 'doctor' && $prescription->doctor?->user_id === $r->user()->id), 403, 'You may only finalize your own prescriptions.');
        $prescription->update(['status' => 'finalized', 'issued_at' => now()]);
        $this->audit($r, 'finalized', 'prescription', $prescription->id, 'Prescription finalized.');
        $this->notifications()->notifyPatient(
            $prescription->patient,
            'Your prescription is ready',
            'A prescription with '.(($prescription->doctor?->display_name) ?? 'your doctor').' has been finalised for you.',
            'prescription.finalized',
            'Prescriptions',
            $prescription->id,
        );
        $this->sendPrescriptionWhatsapp($prescription);

        return $this->ok($prescription->fresh('items'));
    }

    private function sendPrescriptionWhatsapp(Prescription $prescription): void
    {
        if (! config('whatsapp.enabled') || ! $prescription->patient) {
            return;
        }

        $dispatcher = app(WhatsAppDispatcher::class);
        $dispatcher->send(
            $prescription->patient,
            'prescription_ready',
            $dispatcher->values($prescription->patient),
        );
    }

    public function printPrescription(Request $r, Prescription $prescription): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor']);
        if ($r->user()->role === 'doctor') {
            abort_unless($prescription->doctor?->user_id === $r->user()->id, 403, 'You may only print your own prescriptions.');
        }
        abort_if($prescription->status !== 'finalized', 422, 'Only finalized prescriptions can be printed.');

        return $this->ok([
            'prescription' => $prescription->load(['items', 'patient', 'doctor', 'visit']),
            'clinic' => $this->clinicPrintPayload(),
            'printable' => true,
        ]);
    }

    /**
     * Clinic details for a printout, with the logo inlined so the print window
     * can show it without an authenticated image request.
     *
     * @return array<string, mixed>|null
     */
    private function clinicPrintPayload(): ?array
    {
        $clinic = ClinicSetting::query()->first();

        if (! $clinic) {
            return null;
        }

        return $clinic->toArray() + ['logo_data_uri' => ClinicLogo::dataUri($clinic->logo_path)];
    }

    public function invoices(Request $r): mixed
    {
        // A deleted patient still belongs on the invoice they were billed for.
        $q = Invoice::with(['patient' => fn ($patient) => $patient->withTrashed()])
            ->when($r->filled('status'), fn ($q) => $q->where('status', $r->string('status')->toString()))
            ->when($r->filled('patient_id'), fn ($q) => $q->where('patient_id', $r->integer('patient_id')))
            ->when($r->filled('date_from'), fn ($q) => $q->whereDate('invoice_date', '>=', $r->string('date_from')->toString()))
            ->when($r->filled('date_to'), fn ($q) => $q->whereDate('invoice_date', '<=', $r->string('date_to')->toString()))
            ->when($r->filled('search'), function ($q) use ($r) {
                $term = '%'.addcslashes($r->string('search')->toString(), '%_\\').'%';
                $q->where(fn ($w) => $w->where('invoice_number', 'like', $term)
                    ->orWhereHas('patient', fn ($p) => $p->where('first_name', 'like', $term)->orWhere('patient_number', 'like', $term)));
            });
        $sortable = ['invoice_date', 'invoice_number', 'total_amount', 'status'];
        $field = in_array($r->string('sort')->toString(), $sortable, true) ? $r->string('sort')->toString() : 'invoice_date';
        $direction = $r->string('direction')->lower()->toString() === 'asc' ? 'asc' : 'desc';

        return $this->ok($q->orderBy($field, $direction)->orderBy('id', 'desc')->paginate(min(100, max(1, $r->integer('per_page', 20)))));
    }

    public function storeInvoice(Request $r): mixed
    {
        $d = $r->validate(['patient_id' => 'required|exists:patients,id', 'visit_id' => 'nullable|exists:visits,id', 'discount_amount' => 'nullable|numeric|min:0', 'notes' => 'nullable|string', 'items' => 'required|array|min:1', 'items.*.description' => 'required|string', 'items.*.quantity' => 'required|numeric|min:.01', 'items.*.unit_price' => 'required|numeric|min:0']);

        return DB::transaction(function () use ($d, $r) {
            $subtotal = collect($d['items'])->sum(fn ($i) => (float) $i['quantity'] * (float) $i['unit_price']);
            $discount = (float) ($d['discount_amount'] ?? 0);
            abort_if($discount > $subtotal, 422, 'Discount exceeds subtotal.');
            $invoice = Invoice::create(['invoice_number' => $this->number('INV'), 'patient_id' => $d['patient_id'], 'visit_id' => $d['visit_id'] ?? null, 'invoice_date' => today(), 'subtotal' => $subtotal, 'discount_amount' => $discount, 'total_amount' => $subtotal - $discount, 'notes' => $d['notes'] ?? null, 'created_by' => $r->user()->id]);
            $invoice->items()->createMany(array_map(fn ($i) => $i + ['line_total' => (float) $i['quantity'] * (float) $i['unit_price']], $d['items']));

            return $this->ok($invoice->load('items'), 201);
        });
    }

    /**
     * Edit an invoice that has no money against it yet.
     *
     * Once a payment is recorded the invoice is financial history: reverse or
     * refund the payment first, then the invoice can be edited again.
     */
    public function updateInvoice(Request $r, Invoice $invoice): mixed
    {
        $this->authorizeRoles($r, ['admin']);
        abort_if($invoice->status === 'void', 422, 'A void invoice cannot be edited.');
        abort_if($invoice->payments()->where('status', 'completed')->exists(), 422, 'An invoice with recorded payments cannot be edited. Reverse or refund the payments first.');

        $d = $r->validate([
            'items' => 'required|array|min:1',
            'items.*.description' => 'required|string|max:255',
            'items.*.quantity' => 'required|numeric|min:.01',
            'items.*.unit_price' => 'required|numeric|min:0',
            'discount_amount' => 'nullable|numeric|min:0',
            'notes' => 'nullable|string|max:1000',
        ]);

        return DB::transaction(function () use ($d, $r, $invoice) {
            $subtotal = collect($d['items'])->sum(fn ($i) => (float) $i['quantity'] * (float) $i['unit_price']);
            $discount = (float) ($d['discount_amount'] ?? 0);
            abort_if($discount > $subtotal, 422, 'Discount exceeds subtotal.');

            $invoice->update([
                'subtotal' => $subtotal,
                'discount_amount' => $discount,
                'total_amount' => $subtotal - $discount,
                'notes' => $d['notes'] ?? null,
            ]);
            $invoice->items()->get()->each->delete();
            $invoice->items()->createMany(array_map(fn ($i) => $i + ['line_total' => (float) $i['quantity'] * (float) $i['unit_price']], $d['items']));
            $this->audit($r, 'updated', 'invoice', $invoice->id, 'Invoice '.$invoice->invoice_number.' updated.');

            return $this->ok($invoice->fresh()->load(['items', 'payments', 'patient']));
        });
    }

    public function showInvoice(Request $r, Invoice $invoice): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist']);

        return $this->ok($invoice->load(['items', 'payments', 'visit', 'patient' => fn ($patient) => $patient->withTrashed()]));
    }

    public function payment(Request $r, Invoice $invoice): mixed
    {
        $d = $r->validate(['amount' => 'required|numeric|min:.01', 'payment_method' => 'required|in:cash,upi,card,bank_transfer,other', 'transaction_reference' => 'nullable|string', 'notes' => 'nullable|string']);

        return DB::transaction(function () use ($d, $r, $invoice) {
            $invoice = Invoice::query()->lockForUpdate()->findOrFail($invoice->id);
            $paid = $invoice->payments()->where('status', 'completed')->sum('amount');
            abort_if((float) $d['amount'] > $invoice->total_amount - $paid, 422, 'Payment exceeds balance.');
            $p = Payment::create($d + ['payment_number' => $this->number('RCT'), 'invoice_id' => $invoice->id, 'paid_at' => now(), 'received_by' => $r->user()->id]);
            $new = $paid + (float) $d['amount'];
            $invoice->update(['status' => $new >= (float) $invoice->total_amount ? 'paid' : 'partially_paid']);
            $this->notifyAboutPayment($invoice->load('patient'), (float) $d['amount']);

            return $this->ok($p, 201);
        });
    }

    private function notifyAboutPayment(Invoice $invoice, float $amount): void
    {
        $notifications = $this->notifications();
        $patient = $invoice->patient;
        $patientName = $patient ? trim(($patient->first_name ?? '').' '.($patient->last_name ?? '')) : 'A patient';
        $formatted = '₹ '.number_format($amount, 2);

        $notifications->notifyPatient($invoice->patient, 'Payment received', $formatted.' has been recorded against your invoice '.$invoice->invoice_number.'.', 'invoice.paid', 'Bills', $invoice->id);
        $notifications->notifyRoles(['admin'], 'Payment received', $patientName.' paid '.$formatted.' on invoice '.$invoice->invoice_number.'.', 'invoice.paid', 'Billing', $invoice->id);

        if (config('whatsapp.enabled') && $patient) {
            $dispatcher = app(WhatsAppDispatcher::class);
            $dispatcher->send($patient, 'payment_receipt', $dispatcher->values($patient, null, [
                'invoice_number' => $invoice->invoice_number,
                'amount' => $formatted,
            ]));
        }
    }

    private function notifications(): ClinicNotifications
    {
        return app(ClinicNotifications::class);
    }

    public function dashboard(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist']);
        $today = today();
        $appointments = Appointment::query()->whereDate('appointment_date', $today);
        $visits = Visit::query()->whereDate('visit_date', $today);
        if ($r->user()->role === 'doctor') {
            $doctorId = Doctor::where('user_id', $r->user()->id)->value('id');
            $appointments->where('doctor_id', $doctorId);
            $visits->where('doctor_id', $doctorId);
        }

        return $this->ok([
            'appointments_today' => (clone $appointments)->count(),
            'waiting_queue' => (clone $appointments)->where('status', 'waiting')->count(),
            'completed_consultations' => $r->user()->role === 'receptionist' ? null : (clone $visits)->where('status', 'finalized')->count(),
            'collections_today' => $r->user()->role === 'doctor' ? null : Payment::whereDate('paid_at', $today)->where('status', 'completed')->sum('amount'),
            'outstanding' => $r->user()->role === 'doctor' ? null : Invoice::whereIn('status', ['unpaid', 'partially_paid'])->get()->sum('balance'),
        ]);
    }

    public function report(Request $r, string $report): mixed
    {
        $this->authorizeRoles($r, ['admin']);
        $from = $r->date('from') ?? today()->startOfMonth();
        $to = $r->date('to') ?? today();

        if ($r->query('format') === 'csv') {
            return $this->csvReport($report, $from, $to);
        }

        return match ($report) {
            'collections' => $this->ok(Payment::whereBetween('paid_at', [$from, $to->endOfDay()])->where('status', 'completed')->selectRaw('payment_method, SUM(amount) as total, COUNT(*) as count')->groupBy('payment_method')->get()),
            'appointments' => $this->ok(Appointment::whereBetween('appointment_date', [$from, $to])->selectRaw('status, COUNT(*) as count')->groupBy('status')->get()),
            'patients' => $this->ok(['count' => Patient::whereBetween('created_at', [$from, $to->endOfDay()])->count()]),
            'doctor-consultations' => $this->ok(Visit::whereBetween('visit_date', [$from, $to])->whereIn('status', ['finalized', 'amended'])->selectRaw('doctor_id, COUNT(*) as count')->groupBy('doctor_id')->with('doctor')->get()),
            default => abort(404, 'Unknown report'),
        };
    }

    private function csvReport(string $report, mixed $from, mixed $to): mixed
    {
        if ($report === 'collections') {
            $rows = Payment::whereBetween('paid_at', [$from, $to->endOfDay()])->where('status', 'completed')->with(['invoice.patient'])->get()
                ->map(fn (Payment $p) => [$p->payment_number, $p->invoice?->invoice_number, $p->invoice?->patient?->patient_number, $p->amount, $p->payment_method, $p->paid_at?->toDateString()])->toArray();

            return $this->csv('collections.csv', ['payment_number', 'invoice_number', 'patient_number', 'amount', 'method', 'paid_at'], $rows);
        }
        if ($report === 'appointments') {
            $rows = Appointment::whereBetween('appointment_date', [$from, $to])->with(['patient', 'doctor'])->get()
                ->map(fn (Appointment $a) => [$a->appointment_number, $a->patient?->patient_number, $a->doctor?->display_name, $a->appointment_date, $a->status])->toArray();

            return $this->csv('appointments.csv', ['appointment_number', 'patient_number', 'doctor', 'date', 'status'], $rows);
        }
        if ($report === 'doctor-consultations') {
            $rows = Visit::whereBetween('visit_date', [$from, $to])->whereIn('status', ['finalized', 'amended'])->with(['doctor', 'patient'])->get()
                ->map(fn (Visit $v) => [$v->visit_number, $v->patient?->patient_number, $v->doctor?->display_name, $v->visit_date, $v->diagnosis ?? '—'])->toArray();

            return $this->csv('doctor-consultations.csv', ['visit_number', 'patient_number', 'doctor', 'date', 'diagnosis'], $rows);
        }
        if ($report === 'patients') {
            $rows = Patient::whereBetween('created_at', [$from, $to->endOfDay()])->get()
                ->map(fn (Patient $p) => [$p->patient_number, $p->first_name, $p->last_name ?? '', $p->phone ?? '', $p->sex ?? '', $p->created_at?->toDateString()])->toArray();

            return $this->csv('patients.csv', ['patient_number', 'first_name', 'last_name', 'phone', 'sex', 'created_at'], $rows);
        }
        abort(404, 'CSV not supported for this report.');
    }

    // ---- Settings & audit (plan §9, §12) ----

    public function clinicStatus(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist', 'patient']);
        $setting = ClinicSetting::query()->first();

        return $this->ok([
            'clinic_name' => $setting?->clinic_name,
            'address' => $setting?->address,
            'phone' => $setting?->phone,
            'has_logo' => (bool) $setting?->logo_path,
            'theme' => $setting?->theme,
            'country_code' => (string) config('whatsapp.country_code', '91'),
            'timezone' => 'Asia/Kolkata',
            'working_hours' => $setting?->working_hours,
        ]);
    }

    public function clinicSettings(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin']);
        $setting = ClinicSetting::query()->first() ?? new ClinicSetting;
        $setting->timezone = 'Asia/Kolkata';

        return $this->ok($setting);
    }

    public function updateClinicSettings(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin']);
        $d = $r->validate([
            'clinic_name' => 'required|string|max:200',
            'address' => 'nullable|string',
            'phone' => 'nullable|string|max:30',
            'email' => 'nullable|email',
            'timezone' => 'prohibited',
            'appointment_slot_minutes' => 'nullable|integer|min:5|max:120',
            'prescription_footer' => 'nullable|string',
            'invoice_prefix' => 'nullable|string|max:20',
            'receipt_prefix' => 'nullable|string|max:20',
            'working_hours' => 'nullable|array',
            'theme' => ['sometimes', 'nullable', 'array'],
            'theme.primary' => ['required_with:theme', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'theme.accent' => ['required_with:theme', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'theme.background' => ['required_with:theme', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'theme.surface' => ['required_with:theme', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
        ]);
        $d['timezone'] = 'Asia/Kolkata';
        if (array_key_exists('working_hours', $d)) {
            $d['working_hours'] = $this->validatedClinicHours($d['working_hours'] ?? []);
        }
        $setting = ClinicSetting::query()->first() ?? new ClinicSetting;
        $setting->timezone = 'Asia/Kolkata';
        $setting->fill($d)->save();
        $this->audit($r, 'updated', 'clinic_settings', $setting->id, 'Clinic settings updated.');

        return $this->ok($setting);
    }

    /** Upload the clinic logo. Administrators only. */
    public function uploadClinicLogo(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin']);
        $r->validate(['logo' => ['required', 'image', 'max:1024', 'mimes:jpg,jpeg,png,webp']]);

        $setting = ClinicSetting::query()->first() ?? new ClinicSetting;
        if (! $setting->exists) {
            $setting->clinic_name = (string) config('app.name');
            $setting->timezone = 'Asia/Kolkata';
        }
        ClinicLogo::delete($setting->logo_path);
        $setting->logo_path = ClinicLogo::store($r->file('logo'));
        $setting->save();
        $this->audit($r, 'updated', 'clinic_settings', $setting->id, 'Clinic logo uploaded.');

        return $this->ok($setting);
    }

    /** Remove the clinic logo. Administrators only. */
    public function deleteClinicLogo(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin']);
        $setting = ClinicSetting::query()->first();
        abort_unless($setting, 404, 'No clinic settings to update.');

        ClinicLogo::delete($setting->logo_path);
        $setting->logo_path = null;
        $setting->save();
        $this->audit($r, 'updated', 'clinic_settings', $setting->id, 'Clinic logo removed.');

        return $this->ok($setting);
    }

    /** The clinic logo image, for the settings preview and other signed-in staff. */
    public function clinicLogo(Request $r): mixed
    {
        $setting = ClinicSetting::query()->first();

        return ClinicLogo::respond($setting?->logo_path);
    }

    public function auditLogs(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin']);
        $data = $r->validate([
            'search' => ['sometimes', 'string', 'max:80'],
            'action' => ['sometimes', 'string', 'max:40'],
            'entity_type' => ['sometimes', 'string', 'max:40'],
            'user_id' => ['sometimes', 'integer'],
            'date_from' => ['sometimes', 'date'],
            'date_to' => ['sometimes', 'date'],
        ]);

        $query = AuditLog::query()->with('user');

        if (! empty($data['search'])) {
            $term = ListQuery::like($data['search']);
            $query->where(fn ($q) => $q->where('summary', 'like', $term)->orWhere('action', 'like', $term));
        }
        if (! empty($data['action'])) {
            $query->where('action', $data['action']);
        }
        if (! empty($data['entity_type'])) {
            $query->where('entity_type', $data['entity_type']);
        }
        if (! empty($data['user_id'])) {
            $query->where('user_id', $data['user_id']);
        }
        if (! empty($data['date_from'])) {
            $query->whereDate('created_at', '>=', $data['date_from']);
        }
        if (! empty($data['date_to'])) {
            $query->whereDate('created_at', '<=', $data['date_to']);
        }

        return $this->ok($query->latest('created_at')->paginate(ListQuery::perPage($r, 20)));
    }

    /** Filter choices for the activity log: actions, record types and the staff who acted. */
    public function auditLogOptions(Request $r): mixed
    {
        $this->authorizeRoles($r, ['admin']);

        return $this->ok([
            'actions' => AuditLog::query()->distinct()->orderBy('action')->pluck('action')->all(),
            'entity_types' => AuditLog::query()->distinct()->orderBy('entity_type')->pluck('entity_type')->all(),
            'users' => User::query()->where('role', '!=', 'patient')->orderBy('name')->get(['id', 'name', 'role'])
                ->map(fn (User $user): array => ['id' => $user->id, 'name' => $user->name, 'role' => $user->role]),
        ]);
    }

    // ---- Billing lifecycle additions ----

    public function receipt(Request $r, Invoice $invoice): mixed
    {
        $this->authorizeRoles($r, ['admin', 'doctor', 'receptionist']);

        return $this->ok(['invoice' => $invoice->load(['items', 'payments', 'visit', 'patient' => fn ($patient) => $patient->withTrashed()]), 'clinic' => $this->clinicPrintPayload()]);
    }

    public function voidInvoice(Request $r, Invoice $invoice): mixed
    {
        $this->authorizeRoles($r, ['admin']);
        abort_if($invoice->status === 'void', 422, 'This invoice is already void.');
        abort_if($invoice->payments()->where('status', 'completed')->exists(), 422, 'An invoice with recorded payments cannot be voided. Reverse or refund payments first.');
        $invoice->update(['status' => 'void']);
        $this->audit($r, 'voided', 'invoice', $invoice->id, 'Invoice voided by administrator.');

        return $this->ok($invoice->fresh(['items', 'payments', 'patient']));
    }

    public function reversePayment(Request $r, Payment $payment): mixed
    {
        $this->authorizeRoles($r, ['admin']);
        abort_if($payment->status !== 'completed', 422, 'Only completed payments can be reversed.');
        $original = $payment;

        return DB::transaction(function () use ($r, $original): mixed {
            $original->update(['status' => 'reversed']);
            $reversal = Payment::create(['payment_number' => $this->number('RCT'), 'invoice_id' => $original->invoice_id, 'amount' => -((float) $original->amount), 'payment_method' => $original->payment_method, 'transaction_reference' => null, 'paid_at' => now(), 'received_by' => $r->user()->id, 'status' => 'reversed', 'entry_type' => 'reversal', 'reversal_of_id' => $original->id, 'notes' => 'Reversal of '.$original->payment_number]);
            /** @var Invoice $invoice */
            $invoice = Invoice::findOrFail($original->invoice_id);
            $this->refreshInvoiceStatus($invoice);
            $this->audit($r, 'reversed', 'payment', $reversal->id, 'Payment reversed.');

            return $this->ok($reversal, 201);
        });
    }

    public function refundPayment(Request $r, Payment $payment): mixed
    {
        $this->authorizeRoles($r, ['admin']);
        abort_if($payment->status !== 'completed', 422, 'Only completed payments can be refunded.');
        $original = $payment;
        $d = $r->validate(['notes' => 'nullable|string', 'amount' => 'sometimes|numeric|min:0.01|max:'.$original->amount]);

        return DB::transaction(function () use ($r, $original, $d): mixed {
            $refundAmount = isset($d['amount']) ? (float) $d['amount'] : (float) $original->amount;
            $originalAmount = (float) $original->amount;
            abort_if($refundAmount > $originalAmount, 422, 'Refund exceeds original amount.');
            $original->update(['status' => 'refunded']);
            $refund = Payment::create(['payment_number' => $this->number('RCT'), 'invoice_id' => $original->invoice_id, 'amount' => -$refundAmount, 'payment_method' => $original->payment_method, 'transaction_reference' => null, 'paid_at' => now(), 'received_by' => $r->user()->id, 'status' => 'refunded', 'entry_type' => 'refund', 'reversal_of_id' => $original->id, 'notes' => $d['notes'] ?? 'Refund of '.$original->payment_number]);
            $invoice = Invoice::findOrFail($original->invoice_id);
            $this->refreshInvoiceStatus($invoice);
            $this->audit($r, 'refunded', 'payment', $refund->id, 'Payment refunded.');

            return $this->ok($refund, 201);
        });
    }

    /**
     * Clinic opening hours: keys "0".."6" (Sunday..Saturday), each either null (closed)
     * or {"open":"HH:MM","close":"HH:MM"} with open before close.
     *
     * @return array<string, array{open:string,close:string}|null>
     */
    private function validatedClinicHours(array $hours): array
    {
        $clean = [];
        for ($day = 0; $day <= 6; $day++) {
            $entry = $hours[$day] ?? $hours[(string) $day] ?? null;
            if ($entry === null) {
                $clean[(string) $day] = null;

                continue;
            }
            $v = validator($entry, [
                'open' => 'required|date_format:H:i',
                'close' => 'required|date_format:H:i',
            ])->validate();
            abort_unless($v['open'] < $v['close'], 422, 'Clinic opening time must be before closing time.');
            $clean[(string) $day] = ['open' => $v['open'], 'close' => $v['close']];
        }

        return $clean;
    }

    private function authorizeRoles(Request $r, array $roles): void
    {
        abort_unless($r->user() && in_array($r->user()->role, $roles, true), 403, 'Forbidden.');
    }
}
