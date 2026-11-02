<?php

use App\Http\Controllers\ApiController;
use App\Http\Controllers\AiController;
use App\Http\Controllers\DoctorScheduleController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\PatientController;
use App\Http\Controllers\PhotoController;
use App\Http\Controllers\SetupController;
use App\Http\Controllers\UserController;
use App\Http\Controllers\WhatsAppConnectionController;
use App\Http\Controllers\WhatsAppController;
use App\Http\Controllers\WhatsAppTemplateSyncController;
use App\Http\Controllers\WhatsAppWebhookController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function (): void {
    // ---- Public: first-run setup + login ----
    Route::get('setup/status', [SetupController::class, 'status']);
    Route::post('setup/admin', [SetupController::class, 'createAdmin'])->middleware('throttle:login');
    Route::post('login', [ApiController::class, 'login'])->middleware('throttle:login');
    // Public: the clinic logo for the sign-in screen.
    Route::get('clinic/logo', [ApiController::class, 'clinicLogo']);
    Route::get('whatsapp/webhook', [WhatsAppWebhookController::class, 'verify']);
    Route::post('whatsapp/webhook', [WhatsAppWebhookController::class, 'receive']);

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::post('logout', [ApiController::class, 'logout']);
        Route::get('me', [ApiController::class, 'me']);
        Route::match(['put', 'post'], 'me', [ApiController::class, 'updateMe']);
        Route::get('dashboard/summary', [ApiController::class, 'dashboard']);

        // ---- Notifications (in-app + browser push) ----
        Route::get('notifications', [NotificationController::class, 'index']);
        Route::get('notifications/unread-count', [NotificationController::class, 'unreadCount']);
        Route::post('notifications/read-all', [NotificationController::class, 'markAllAsRead']);
        Route::post('notifications/{notification}/read', [NotificationController::class, 'markAsRead']);
        Route::delete('notifications/{notification}', [NotificationController::class, 'destroy']);
        Route::get('notifications/push/key', [NotificationController::class, 'pushKey']);
        Route::post('notifications/push/subscribe', [NotificationController::class, 'subscribe']);
        Route::post('notifications/push/unsubscribe', [NotificationController::class, 'unsubscribe']);

        // ---- Patients (filters, sort, pagination, CRUD, photo) ----
        Route::get('patients', [PatientController::class, 'index']);
        Route::get('patients/check-duplicates', [PatientController::class, 'checkDuplicate']);
        Route::post('patients', [PatientController::class, 'store']);
        Route::get('patients/{patient}', [PatientController::class, 'show']);
        Route::match(['put', 'patch', 'post'], 'patients/{patient}', [PatientController::class, 'update']);
        Route::delete('patients/{patient}', [PatientController::class, 'destroy'])->middleware('role:admin');
        Route::get('patients/{patient}/avatar', [PatientController::class, 'avatar']);
        Route::post('patients/{patient}/portal-password', [PatientController::class, 'resetLogin'])->middleware('role:admin');
        Route::get('patients/{patient}/visits', [ApiController::class, 'patientVisits']);
        Route::get('patients/{patient}/appointments', [ApiController::class, 'patientAppointments']);

        // ---- Patient self-service (portal role): own record only ----
        Route::get('portal/me', [PatientController::class, 'portalMe']);
        Route::match(['put', 'post'], 'portal/me', [PatientController::class, 'updatePortalMe']);
        Route::get('portal/visits', [PatientController::class, 'portalVisits']);
        Route::get('portal/visits/{visit}', [PatientController::class, 'portalVisit']);
        Route::get('portal/appointments', [PatientController::class, 'portalAppointments']);
        Route::post('portal/appointments', [PatientController::class, 'bookAppointment']);
        Route::post('portal/appointments/{appointment}/cancel', [PatientController::class, 'cancelAppointment']);
        Route::get('portal/prescriptions', [PatientController::class, 'portalPrescriptions']);
        Route::get('portal/prescriptions/{prescription}', [PatientController::class, 'portalPrescription']);
        Route::get('portal/prescriptions/{prescription}/print', [PatientController::class, 'portalPrescriptionPrint']);
        Route::get('portal/invoices', [PatientController::class, 'portalInvoices']);
        Route::get('portal/invoices/{invoice}', [PatientController::class, 'portalInvoice']);
        Route::get('portal/invoices/{invoice}/receipt', [PatientController::class, 'portalInvoiceReceipt']);

        // ---- Staff users (admin only) ----
        Route::get('users', [UserController::class, 'index'])->middleware('role:admin');
        Route::post('users', [UserController::class, 'store'])->middleware('role:admin');
        Route::get('users/{user}', [UserController::class, 'show'])->middleware('role:admin');
        Route::match(['put', 'patch', 'post'], 'users/{user}', [UserController::class, 'update'])->middleware('role:admin');
        Route::delete('users/{user}', [UserController::class, 'destroy'])->middleware('role:admin');
        Route::post('users/{user}/reactivate', [UserController::class, 'reactivate'])->middleware('role:admin');
        Route::get('users/{user}/avatar', [UserController::class, 'avatar']);

        // ---- Profile photos (clinic staff) ----
        Route::get('photos', [PhotoController::class, 'index'])->middleware('role:admin,doctor,receptionist');
        Route::post('photos/{type}/{id}', [PhotoController::class, 'update'])->middleware('role:admin,doctor,receptionist');
        Route::delete('photos/{type}/{id}', [PhotoController::class, 'destroy'])->middleware('role:admin,doctor,receptionist');

        // ---- Doctors & schedules ----
        Route::get('doctors', [ApiController::class, 'listDoctors']);
        Route::get('doctors/{doctor}', [ApiController::class, 'showDoctor']);
        Route::get('doctors/{doctor}/availability', [ApiController::class, 'doctorAvailability']);
        Route::get('doctors/{doctor}/schedules', [DoctorScheduleController::class, 'index']);
        Route::put('doctors/{doctor}/schedules', [DoctorScheduleController::class, 'replace'])->middleware('role:admin');
        Route::post('doctors/{doctor}/schedules', [ApiController::class, 'storeDoctorSchedule'])->middleware('role:admin');
        Route::put('doctor-schedules/{schedule}', [ApiController::class, 'updateDoctorSchedule'])->middleware('role:admin');
        Route::delete('doctor-schedules/{schedule}', [ApiController::class, 'deleteDoctorSchedule'])->middleware('role:admin');

        // ---- Appointments & queue ----
        Route::get('appointments', [ApiController::class, 'appointments']);
        Route::post('appointments', [ApiController::class, 'storeAppointment'])->middleware('role:admin,receptionist');
        Route::get('appointments/{appointment}', [ApiController::class, 'showAppointment']);
        Route::put('appointments/{appointment}', [ApiController::class, 'updateAppointment'])->middleware('role:admin,receptionist');
        Route::post('appointments/{appointment}/cancel', [ApiController::class, 'cancelAppointment'])->middleware('role:admin,receptionist');
        Route::post('appointments/{appointment}/status', [ApiController::class, 'appointmentStatus'])->middleware('role:admin,doctor,receptionist');
        Route::post('walk-ins', [ApiController::class, 'walkIn'])->middleware('role:admin,receptionist');

        // ---- Visits & prescriptions ----
        Route::get('visits', [ApiController::class, 'listVisits'])->middleware('role:admin,doctor,receptionist');
        Route::post('visits', [ApiController::class, 'storeVisit'])->middleware('role:admin,doctor');
        Route::get('visits/{visit}', [ApiController::class, 'showVisit']);
        Route::put('visits/{visit}', [ApiController::class, 'updateVisit'])->middleware('role:admin,doctor');
        Route::post('visits/{visit}/finalize', [ApiController::class, 'finalizeVisit'])->middleware('role:admin,doctor');
        Route::post('visits/{visit}/amendments', [ApiController::class, 'amendVisit'])->middleware('role:admin,doctor');
        Route::post('visits/{visit}/prescriptions', [ApiController::class, 'storePrescription'])->middleware('role:admin,doctor');
        Route::get('prescriptions', [ApiController::class, 'listPrescriptions'])->middleware('role:admin,doctor');
        Route::get('prescriptions/{prescription}', [ApiController::class, 'showPrescription'])->middleware('role:admin,doctor');
        Route::put('prescriptions/{prescription}', [ApiController::class, 'updatePrescription'])->middleware('role:admin,doctor');
        Route::delete('prescriptions/{prescription}', [ApiController::class, 'deletePrescription'])->middleware('role:admin,doctor');
        Route::post('prescriptions/{prescription}/finalize', [ApiController::class, 'finalizePrescription'])->middleware('role:admin,doctor');
        Route::get('prescriptions/{prescription}/print', [ApiController::class, 'printPrescription']);

        // ---- Billing ----
        Route::get('invoices', [ApiController::class, 'invoices'])->middleware('role:admin,receptionist');
        Route::post('invoices', [ApiController::class, 'storeInvoice'])->middleware('role:admin,doctor,receptionist');
        Route::get('invoices/{invoice}', [ApiController::class, 'showInvoice'])->middleware('role:admin,doctor,receptionist');
        Route::put('invoices/{invoice}', [ApiController::class, 'updateInvoice'])->middleware('role:admin');
        Route::post('invoices/{invoice}/payments', [ApiController::class, 'payment'])->middleware('role:admin,receptionist');
        Route::get('invoices/{invoice}/receipt', [ApiController::class, 'receipt'])->middleware('role:admin,doctor,receptionist');
        Route::post('invoices/{invoice}/void', [ApiController::class, 'voidInvoice'])->middleware('role:admin');
        Route::post('payments/{payment}/reverse', [ApiController::class, 'reversePayment'])->middleware('role:admin');
        Route::post('payments/{payment}/refund', [ApiController::class, 'refundPayment'])->middleware('role:admin');

        // ---- WhatsApp reminders (admin) ----
        Route::get('whatsapp/status', [WhatsAppController::class, 'status'])->middleware('role:admin');
        Route::post('whatsapp/coexistence/start', [WhatsAppConnectionController::class, 'start'])->middleware(['role:admin', 'throttle:5,1']);
        Route::post('whatsapp/coexistence/complete', [WhatsAppConnectionController::class, 'complete'])->middleware(['role:admin', 'throttle:5,1']);
        Route::get('whatsapp/coexistence/events', [WhatsAppWebhookController::class, 'events'])->middleware('role:admin');
        Route::get('whatsapp/meta-templates', [WhatsAppTemplateSyncController::class, 'index'])->middleware('role:admin');
        Route::post('whatsapp/meta-templates/pull', [WhatsAppTemplateSyncController::class, 'pull'])->middleware(['role:admin', 'throttle:10,1']);
        Route::post('whatsapp/templates/{event}/adopt', [WhatsAppTemplateSyncController::class, 'adopt'])->middleware('role:admin');
        Route::delete('whatsapp/templates/{event}/link', [WhatsAppTemplateSyncController::class, 'unlink'])->middleware('role:admin');
        Route::post('whatsapp/templates/{event}/publish', [WhatsAppTemplateSyncController::class, 'publish'])->middleware(['role:admin', 'throttle:10,1']);
        Route::put('whatsapp/templates/{event}', [WhatsAppController::class, 'updateTemplate'])->middleware('role:admin');
        Route::get('whatsapp/templates/{event}/preview', [WhatsAppController::class, 'preview'])->middleware('role:admin');
        Route::get('whatsapp/sender', [WhatsAppController::class, 'senderState'])->middleware('role:admin,doctor,receptionist');
        Route::post('whatsapp/test', [WhatsAppController::class, 'sendTest'])->middleware('role:admin');
        Route::post('whatsapp/send', [WhatsAppController::class, 'sendToPatient'])->middleware(['role:admin,doctor,receptionist', 'throttle:30,1']);
        Route::get('whatsapp/messages', [WhatsAppController::class, 'messages'])->middleware('role:admin');
        Route::get('patients/{patient}/whatsapp-messages', [WhatsAppController::class, 'patientMessages']);
        Route::put('patients/{patient}/whatsapp-consent', [WhatsAppController::class, 'setConsent'])->middleware('role:admin,receptionist');
        Route::post('appointments/{appointment}/reminder', [WhatsAppController::class, 'remind'])->middleware('role:admin,receptionist');

        // ---- Reports, settings, audit ----
        Route::get('reports/{report}', [ApiController::class, 'report'])->middleware('role:admin');

        // ---- AI (clinic-connected provider + assist drafts) ----
        Route::get('ai/status', [AiController::class, 'status'])->middleware('role:admin,doctor,receptionist');
        Route::get('ai/config', [AiController::class, 'config'])->middleware('role:admin');
        Route::put('ai/config', [AiController::class, 'saveConfig'])->middleware('role:admin');
        Route::post('ai/models', [AiController::class, 'fetchModels'])->middleware(['role:admin', 'throttle:10,1']);
        Route::post('ai/assist/consultation', [AiController::class, 'consultationAssist'])->middleware(['role:admin,doctor', 'throttle:15,1']);
        Route::post('ai/assist/prescription', [AiController::class, 'prescriptionAssist'])->middleware(['role:admin,doctor', 'throttle:15,1']);
        Route::post('ai/assist/patient-summary', [AiController::class, 'patientSummary'])->middleware(['role:admin,doctor,receptionist', 'throttle:20,1']);
        Route::post('ai/ask', [AiController::class, 'ask'])->middleware(['role:admin,doctor,receptionist', 'throttle:30,1']);

        Route::get('clinic/status', [ApiController::class, 'clinicStatus'])->middleware('role:admin,doctor,receptionist,patient');
        Route::get('settings/clinic', [ApiController::class, 'clinicSettings'])->middleware('role:admin');
        Route::put('settings/clinic', [ApiController::class, 'updateClinicSettings'])->middleware('role:admin');
        Route::post('settings/clinic/logo', [ApiController::class, 'uploadClinicLogo'])->middleware('role:admin');
        Route::delete('settings/clinic/logo', [ApiController::class, 'deleteClinicLogo'])->middleware('role:admin');
        Route::get('settings/clinic/logo', [ApiController::class, 'clinicLogo']);
        Route::get('audit-logs', [ApiController::class, 'auditLogs'])->middleware('role:admin');
        Route::get('audit-logs/options', [ApiController::class, 'auditLogOptions'])->middleware('role:admin');
    });
});
