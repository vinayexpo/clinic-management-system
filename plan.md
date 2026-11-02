# Clinic Management System — Plan A
## Detailed Implementation Plan

**Product type:** Single-clinic management system  
**Target users:** Small clinics and independent medical practices  
**Target development budget:** ₹40,000–₹60,000 for a tightly scoped MVP  
**Target timeline:** 4–5 weeks  
**Frontend:** React + Vite + TypeScript + Material UI (MUI)  
**Backend:** Laravel 13 REST API  
**Database:** MySQL 8+  
**Authentication:** Laravel Sanctum  
**Icons:** Tabler Icons (`@tabler/icons-react`)  
**Hosting target:** Hostinger-compatible shared hosting  
**Infrastructure constraint:** Do not require Redis, Docker, Supervisor, or persistent queue workers in production.

---

## 1. Product goal

Build a responsive, easy-to-use clinic management system that handles the essential daily workflow:

1. Register or find a patient.
2. Book an appointment or register a walk-in.
3. Manage the doctor’s queue.
4. Record a consultation.
5. Create and print a prescription.
6. Generate a bill and record payment.
7. Schedule a follow-up.
8. Review basic operational and collection reports.

This is **Plan A — Clinic** for one clinic. The code structure should remain modular so future versions can add pharmacy, laboratory, inpatient/bed management, multiple clinics, and SaaS subscriptions without rebuilding the MVP.

## 2. MVP scope

### Included

- Login, logout, password reset flow, and user profile
- Roles: Clinic Admin, Doctor, Receptionist
- Clinic profile and printable document branding
- Patient registration, search, patient ID, contact details, allergies, and visit history
- Appointment booking, rescheduling, cancellation, walk-ins, token/queue number, and status updates
- Doctor schedule and clinic working hours
- Consultation notes, symptoms, vital signs, diagnosis, treatment notes, and follow-up date
- Prescription creation with medicine name, strength, dosage, route if required, frequency, duration, quantity, and instructions
- Printable prescription with clinic details and doctor details
- Consultation invoice, discounts subject to permission, payment entries, receipts, and outstanding balances
- Dashboard, daily/monthly collections, appointments, patient registration reports
- Audit logging for important actions
- Responsive layouts for desktop, tablet, and mobile
- CSV export for appropriate non-clinical reports, subject to permissions
- Database backup and restore procedure documented for the operator

### Explicitly excluded from the first release

- Pharmacy inventory and dispensing
- Laboratory management and lab integrations
- IPD, beds, wards, nursing, and discharge
- Multi-clinic / multi-tenant SaaS administration
- Native Android or iOS applications
- WhatsApp/SMS automation and paid messaging integrations
- AI diagnosis or treatment recommendations
- Insurance claims, advanced accounting, and medical-device integrations
- Online patient portal and patient self-booking
- Complex third-party integrations

Do not build excluded modules as hidden, incomplete screens. Keep the architecture extensible, but deliver only the agreed MVP.

## 3. User roles and permissions

### Clinic Admin
- Manage clinic profile, working hours, users, doctor profiles, and fee defaults
- View and manage all patients, appointments, consultations, prescriptions, invoices, and reports
- Record and approve discounts/refunds according to clinic policy
- View audit logs and operational reports
- Cannot silently overwrite finalized clinical records; corrections must be auditable

### Doctor
- View assigned appointments and relevant patient history
- Record and edit their own draft consultation notes
- Finalize consultations and create prescriptions
- Set follow-up recommendations
- View clinical information needed for care
- No user administration or unrestricted financial configuration by default

### Receptionist
- Register/search patients and manage appointments/queue
- Create invoices and record payments
- Print receipts
- View only the clinical information needed for scheduling and administration
- Cannot edit finalized consultation notes or prescriptions
- Cannot access administrative settings or sensitive reports unless explicitly granted

Enforce permissions in Laravel policies/middleware and on the API. Hiding a button in React is not a security control.

## 4. Core user journeys

### 4.1 New patient and appointment
1. Receptionist opens **Patients → Add Patient**.
2. Enters required details and checks for a possible duplicate by phone/name/date of birth.
3. System assigns a unique, non-sequential or appropriately controlled patient number.
4. Receptionist books a date/time, selects a doctor, and adds an optional reason for visit.
5. System confirms booking and adds the patient to the day’s appointment list.

### 4.2 Walk-in and queue
1. Receptionist searches for or registers the patient.
2. Creates a walk-in appointment for the current clinic date.
3. System assigns a queue/token number using a transaction-safe method.
4. Status progresses through `waiting`, `in_consultation`, and `completed`, or `cancelled`/`no_show`.
5. Avoid duplicate active queue numbers for the same doctor/date.

### 4.3 Consultation and prescription
1. Doctor opens an appointment and reviews relevant history.
2. Records symptoms, vitals where available, examination notes, diagnosis, and plan.
3. Adds prescription items and follow-up details.
4. Saves as draft or finalizes.
5. Finalized records become read-only for ordinary edits; use an audited amendment/correction workflow.
6. Print or save the prescription through a server-generated PDF or a reliable print stylesheet.

### 4.4 Billing and payment
1. Receptionist creates an invoice using clinic-configured consultation fee defaults.
2. System calculates subtotal, discount, and total on the server.
3. Record one or more payments (cash, UPI, card, bank transfer, or other configured method).
4. Derive paid amount and balance from payment records; do not trust totals sent by the browser.
5. Generate a unique receipt number and printable receipt.
6. Refunds or reversals must be recorded as new audited transactions, not by deleting payment history.

### 4.5 Follow-up
1. Doctor records a follow-up date and instructions.
2. Receptionist can create the next appointment from the patient/visit screen.
3. No automatic messaging in MVP.

## 5. Application navigation and screen inventory

Use a consistent app shell with a collapsible desktop sidebar, a mobile drawer, a top bar, clinic identity, current user menu, and clear page titles.

### Authentication
- Login
- Forgot password / reset password
- Unauthorized / session-expired states

### Dashboard
- Today’s appointment count
- Waiting queue count
- Completed consultations
- Today’s collections and outstanding balance
- Upcoming appointments
- Quick actions: Add Patient, Book Appointment, Start Walk-in
- Simple date filter and empty/loading/error states

### Patients
- Patient list with search, pagination, and filters
- Add patient
- Patient details/profile
- Edit patient
- Visit history timeline
- Patient duplicate warning/merge-review workflow (manual review; do not auto-merge)

### Appointments
- Daily list view as the default
- Calendar view only if feasible within budget
- Create/edit appointment
- Appointment detail
- Walk-in registration
- Queue management
- Status updates and cancellation reason

### Consultation
- Consultation workspace
- Patient summary and prior visit history
- Vitals section
- Symptoms and examination notes
- Diagnosis and treatment plan
- Follow-up date
- Draft/finalized state
- Amendment history where supported

### Prescriptions
- Create/edit draft prescription
- Prescription preview
- Printable prescription
- Prescription history per patient
- Medicine entries are text-based in MVP; no stock or dispensing workflow

### Billing
- Invoice list
- Create invoice
- Invoice detail
- Record payment
- Payment history
- Printable receipt
- Outstanding balance report
- Refund/reversal workflow with permissions and audit trail

### Reports
- Daily collection report
- Monthly collection report
- Appointment status report
- Patient registration report
- Doctor consultation count
- CSV export with permission checks

### Settings
- Clinic name, address, phone, email, logo, registration details if applicable
- Working hours and appointment slot duration
- Doctor profiles and consultation fee defaults
- Users and role assignment
- Invoice/receipt numbering configuration
- Prescription footer and print settings
- Audit log viewer for authorized admins

## 6. UI/UX standards — Material UI

Use **Material UI (MUI)** for all application components. Do not mix in another component framework.

Recommended packages:
- `@mui/material`
- `@mui/icons-material` only if needed; the project preference is Tabler Icons, so use `@tabler/icons-react` for product icons
- `@emotion/react`
- `@emotion/styled`
- `@mui/x-date-pickers` only if compatible with selected MUI versions and budget; otherwise use native/date input components with clear validation
- React Router
- TanStack Query for API state and caching
- React Hook Form + Zod for form handling and validation, if the team is comfortable with them

### Visual direction
- Professional, calm healthcare interface
- Light theme as default; optional dark mode only if inexpensive
- White/light neutral surfaces, restrained blue/teal accent, high contrast, and status colors used consistently
- Dense but readable data tables on desktop; cards and stacked rows on mobile
- Clear labels, helper text, validation messages, confirmation for destructive actions
- Do not rely on color alone for status
- Consistent spacing, typography, radii, buttons, form fields, dialogs, snackbars, tabs, chips, breadcrumbs, and pagination
- Keep important actions reachable without excessive scrolling
- Accessible keyboard navigation, visible focus, semantic labels, and reasonable touch targets
- Use realistic but fictional demo data in the design; never use real patient data

### Responsive behavior
- Desktop: sidebar + main content; tables with useful columns and filters
- Tablet: narrower navigation and flexible grids
- Mobile: navigation drawer, stacked cards/forms, horizontal overflow only where unavoidable, full-width primary actions
- At 320–375 px wide, core patient registration, appointment, consultation, prescription preview, and billing should remain usable

## 7. Technical architecture

### Frontend
- React + Vite + TypeScript
- MUI theme and shared component layer
- React Router routes aligned with the screen inventory
- Central API client with consistent error handling
- Authentication state based on the chosen Sanctum mode
- TanStack Query for server state; do not duplicate API data in many unrelated local states
- React Hook Form/Zod (or a consistent alternative) for validated forms
- Route guards for user experience, with actual authorization enforced server-side
- Shared types for API requests/responses

### Backend
- Laravel 13 REST API, organized as a modular monolith
- Controllers kept thin; use Form Requests for validation and service/action classes for multi-step business logic
- Laravel Policies for authorization
- API Resources for consistent response shapes
- Database transactions for patient/appointment queue assignment, invoice creation, payment recording, and receipt number allocation
- Rate-limit authentication and other sensitive endpoints
- Store uploads privately; use authorized download routes
- Avoid returning unnecessary clinical data in list APIs

### Authentication decision
Prefer Sanctum with secure, HTTP-only, Secure (in HTTPS production), SameSite-appropriate cookies for a first-party React app when frontend/backend deployment allows it. Configure CORS and CSRF correctly. Do not store session/authentication secrets in `localStorage`. If deployment topology makes cookie authentication impractical, document the alternative and its security trade-offs before implementation.

### Shared-hosting constraints
- No Redis requirement
- Use database-backed sessions/cache/queues only where supported and configured
- Queue workers must not be required for core workflows
- Use cron for scheduled maintenance tasks if any are needed
- Avoid persistent processes and services not supported by the selected hosting plan
- Verify the hosting plan supports the selected PHP version, required PHP extensions, MySQL version, document root configuration, cron jobs, HTTPS, and storage permissions
- Keep deploy steps compatible with a conventional Apache/shared-hosting environment

## 8. Database schema outline

Use migrations, foreign keys, unique constraints, indexes, timestamps, and soft deletes only where appropriate. All timestamps should be handled consistently; clinic display time zone should be configurable.

### `users`
- `id`
- `name`
- `email` (unique where email is required)
- `phone` (nullable, indexed where useful)
- `password`
- `role` (`admin`, `doctor`, `receptionist`) or a roles/permissions package if justified
- `is_active`
- `last_login_at`
- timestamps

### `clinic_settings`
- `id`
- `clinic_name`
- `address`
- `phone`
- `email`
- `logo_path` (private or access-controlled)
- `timezone`
- `working_hours` (structured JSON or normalized table)
- `appointment_slot_minutes`
- `prescription_footer`
- `invoice_prefix`
- `receipt_prefix`
- timestamps

### `doctors`
- `id`
- `user_id` (nullable if doctor profile is managed independently, otherwise required)
- `display_name`
- `qualification`
- `specialization` (optional)
- `registration_number` (optional; validate applicability)
- `consultation_fee`
- `is_active`
- timestamps

### `patients`
- `id`
- `patient_number` (unique)
- `first_name`, `last_name` (or `full_name` if kept consistently)
- `date_of_birth` (nullable)
- `sex` / gender field with carefully chosen options and “prefer not to say” where appropriate
- `phone`
- `email` (nullable)
- `address` (nullable)
- `emergency_contact_name` (nullable)
- `emergency_contact_phone` (nullable)
- `allergies_summary` (nullable; not a substitute for structured clinical documentation)
- `created_by`
- timestamps
- soft delete only with a documented retention/record-preservation policy

### `appointments`
- `id`
- `appointment_number` (unique)
- `patient_id`
- `doctor_id`
- `appointment_date`
- `start_time`
- `end_time` (nullable)
- `visit_type` (`appointment`, `walk_in`)
- `token_number` (nullable)
- `status` (`booked`, `waiting`, `in_consultation`, `completed`, `cancelled`, `no_show`)
- `reason_for_visit` (optional)
- `cancel_reason` (nullable)
- `created_by`
- timestamps
- Indexes on date, doctor, patient, and status
- Define and enforce token uniqueness for doctor/date using a safe allocation strategy

### `visits`
- `id`
- `visit_number` (unique)
- `patient_id`
- `appointment_id` (nullable for supported edge cases)
- `doctor_id`
- `visit_date`
- `symptoms` (nullable)
- `vitals` (structured JSON or normalized fields; document the choice)
- `examination_notes` (nullable)
- `diagnosis` (nullable)
- `treatment_plan` (nullable)
- `follow_up_date` (nullable)
- `status` (`draft`, `finalized`, `amended`)
- `finalized_at` (nullable)
- `created_by`
- timestamps

### `prescriptions`
- `id`
- `prescription_number` (unique)
- `visit_id`
- `patient_id`
- `doctor_id`
- `issued_at`
- `instructions` (nullable)
- `status` (`draft`, `finalized`, `cancelled`)
- timestamps

### `prescription_items`
- `id`
- `prescription_id`
- `medicine_name`
- `strength` (nullable)
- `dosage`
- `route` (nullable)
- `frequency`
- `duration`
- `quantity` (nullable)
- `instructions` (nullable)
- `sort_order`
- timestamps

### `invoices`
- `id`
- `invoice_number` (unique)
- `patient_id`
- `visit_id` (nullable)
- `invoice_date`
- `subtotal`
- `discount_amount`
- `total_amount`
- `status` (`unpaid`, `partially_paid`, `paid`, `void`)
- `notes` (nullable)
- `created_by`
- timestamps

### `invoice_items`
- `id`
- `invoice_id`
- `description`
- `quantity`
- `unit_price`
- `line_total`
- timestamps

### `payments`
- `id`
- `payment_number` (unique)
- `invoice_id`
- `amount`
- `payment_method` (`cash`, `upi`, `card`, `bank_transfer`, `other`)
- `transaction_reference` (nullable)
- `paid_at`
- `received_by`
- `status` (`completed`, `reversed`, `refunded`)
- `notes` (nullable)
- timestamps

### `audit_logs`
- `id`
- `user_id` (nullable for system events)
- `action`
- `entity_type`
- `entity_id`
- `summary` (avoid unnecessary sensitive details)
- `ip_address` (where lawful and appropriate)
- `user_agent` (optional)
- `created_at`

### Data integrity rules
- Never calculate authoritative invoice totals solely in the browser.
- Use decimal types for money, not floating-point types.
- Use transactions for invoice/payment creation and receipt numbering.
- Preserve payment history; use reversals/refunds rather than deleting records.
- Avoid cascading deletes for clinical and financial records.
- Restrict edits to finalized consultations and prescriptions; retain audit trails for amendments.
- Enforce patient/visit/doctor relationship consistency.
- Use private storage and authorized access for uploaded documents if uploads are added.

## 9. API outline

Use `/api/v1` versioning. Return consistent JSON, validation errors, and pagination metadata.

### Authentication
- `POST /api/v1/login`
- `POST /api/v1/logout`
- `GET /api/v1/me`
- Password reset endpoints as supported by configured mail delivery

### Dashboard
- `GET /api/v1/dashboard/summary`
- `GET /api/v1/dashboard/appointments`
- `GET /api/v1/dashboard/collections`

### Patients
- `GET /api/v1/patients`
- `POST /api/v1/patients`
- `GET /api/v1/patients/{patient}`
- `PUT /api/v1/patients/{patient}`
- `GET /api/v1/patients/{patient}/visits`
- `GET /api/v1/patients/{patient}/appointments`

### Doctors and appointments
- `GET /api/v1/doctors`
- `GET /api/v1/doctors/{doctor}/availability`
- `GET /api/v1/appointments`
- `POST /api/v1/appointments`
- `GET /api/v1/appointments/{appointment}`
- `PUT /api/v1/appointments/{appointment}`
- `POST /api/v1/appointments/{appointment}/cancel`
- `POST /api/v1/appointments/{appointment}/status`
- `POST /api/v1/walk-ins`

### Visits and prescriptions
- `POST /api/v1/visits`
- `GET /api/v1/visits/{visit}`
- `PUT /api/v1/visits/{visit}` (draft only, per permissions)
- `POST /api/v1/visits/{visit}/finalize`
- `POST /api/v1/visits/{visit}/amendments` (if included in MVP)
- `POST /api/v1/visits/{visit}/prescriptions`
- `GET /api/v1/prescriptions/{prescription}`
- `POST /api/v1/prescriptions/{prescription}/finalize`
- `GET /api/v1/prescriptions/{prescription}/print`

### Billing
- `GET /api/v1/invoices`
- `POST /api/v1/invoices`
- `GET /api/v1/invoices/{invoice}`
- `POST /api/v1/invoices/{invoice}/payments`
- `GET /api/v1/invoices/{invoice}/receipt`
- `POST /api/v1/payments/{payment}/reverse` (authorized users only)

### Reports and settings
- `GET /api/v1/reports/collections`
- `GET /api/v1/reports/appointments`
- `GET /api/v1/reports/patients`
- `GET /api/v1/reports/doctor-consultations`
- `GET /api/v1/settings/clinic`
- `PUT /api/v1/settings/clinic`
- User and doctor management endpoints restricted to admins
- `GET /api/v1/audit-logs` restricted to authorized admins

Adjust the final endpoint list to the exact implemented screens. Do not expose endpoints that are not implemented.

## 10. Validation and business rules

- Validate all fields server-side using Laravel Form Requests.
- Check duplicate patients by phone/name/date of birth and warn for review; do not automatically merge.
- Prevent overlapping appointments for the same doctor unless explicitly allowed by clinic policy.
- Validate appointment state transitions.
- Allocate token numbers in a transaction-safe manner.
- Require a valid doctor and patient for a clinical visit.
- Prevent receptionists from finalizing or modifying clinical records.
- Use server-calculated prices, totals, discounts, and balances.
- Require permissions for discounts, voids, refunds, and payment reversals.
- Store finalized prescriptions and consultations with timestamps and author identity.
- Use explicit empty, loading, success, validation-error, permission-denied, and server-error states in the UI.

## 11. Security, privacy, and reliability

- Enforce HTTPS in production.
- Use secure, HTTP-only cookies for Sanctum when using first-party SPA cookie authentication; configure CSRF and CORS correctly.
- Never put authentication secrets in `localStorage`.
- Apply least-privilege permissions on the server.
- Rate-limit login and sensitive endpoints.
- Validate uploads by type/size and keep them private.
- Avoid logging passwords, session tokens, full prescription contents, or unnecessary personal health information.
- Keep audit records for access-sensitive and financial/clinical changes.
- Set up automated database backups where hosting permits; periodically test restoration.
- Document who can access backups and how long they are retained.
- Use dependency updates and production error handling; do not display stack traces to users.
- Review applicable Indian privacy, data-protection, medical-record, and professional requirements before production use. This plan is technical guidance, not legal advice.

## 12. Testing checklist

### Functional
- Create, search, and edit patients
- Detect possible duplicates
- Book, reschedule, cancel, and complete appointments
- Register walk-ins and allocate queue tokens
- Record and finalize a consultation
- Create and print prescriptions
- Create invoices, record partial/full payments, and print receipts
- Calculate outstanding balances correctly
- Produce date-filtered reports

### Permissions
- Receptionist cannot access restricted clinical editing or settings
- Doctor cannot administer users or perform unauthorized financial actions
- Inactive users cannot sign in
- Unauthorized API requests are rejected even if made outside the UI

### Reliability and data
- Duplicate submissions do not create duplicate invoices/payments
- Concurrent token allocation does not duplicate active tokens
- Invoice calculations use decimal arithmetic and server-side validation
- Clinical/financial records are not silently deleted
- Backup restoration is documented and tested

### Responsive and accessibility
- Test 320px, 375px, 768px, 1024px, and wide desktop layouts
- Test keyboard navigation and visible focus
- Confirm form errors are associated with fields
- Confirm table actions are usable on touch screens
- Test print output for prescriptions and receipts

## 13. Development plan and milestones

### Week 1 — Foundation
- Confirm requirements and UI generated from the separate Google Stitch prompt
- Create repository and React/Vite/TypeScript frontend
- Set up Laravel API, MySQL, migrations, Sanctum, and roles
- Establish MUI theme, routing, shared app shell, and API error handling

### Week 2 — Patients and appointments
- Patient list, create/edit forms, profile and visit-history shell
- Doctor profiles and availability
- Appointment booking, daily list, walk-ins, and queue status
- Role enforcement and validation

### Week 3 — Consultations and prescriptions
- Consultation workspace and vitals
- Draft/finalized consultation states
- Prescription editor and print layout
- Patient visit timeline

### Week 4 — Billing and reports
- Invoices and invoice items
- Payment recording and receipts
- Dashboard summary and basic reports
- Clinic settings and branding

### Week 5 — Hardening and release
- Permission and workflow testing
- Responsive fixes
- Backup/restore test
- Hosting deployment, configuration, HTTPS, and production smoke test
- Short operator guide and handover

Timeline assumes a tightly controlled scope and an experienced developer. If time or budget is constrained, prioritize the daily list appointment flow over a complex calendar and deliver only the reports required by the pilot clinic.

## 14. Deployment checklist — shared hosting

1. Confirm PHP version and required extensions supported by the chosen Hostinger plan.
2. Create production MySQL database and least-privilege database user.
3. Configure environment variables securely; do not commit `.env`.
4. Set Laravel document root to the `public` directory where the host permits, or follow the host's supported secure deployment pattern.
5. Run migrations using the supported deployment method.
6. Build React assets for production and configure the SPA/API routing appropriately.
7. Configure Sanctum stateful domains, CORS, cookies, and CSRF.
8. Set correct storage and cache permissions.
9. Enable HTTPS and production error handling.
10. Configure database backups and scheduled tasks only if required.
11. Verify login, patient registration, appointment, consultation, prescription print, invoice, payment, and report workflows.
12. Keep secrets, database backups, and private documents outside public access.
13. Document rollback steps and how to restore a backup.

## 15. Acceptance criteria

The MVP is ready for pilot use when:

- Admin, doctor, and receptionist accounts have correct access boundaries.
- A receptionist can register a patient, book a visit, manage the queue, create a bill, record payment, and print a receipt.
- A doctor can review history, document a consultation, finalize it, create a prescription, and print it.
- A patient’s history shows their visits and prescriptions to authorized users.
- Reports match the underlying records and date filters.
- The system works on desktop and mobile browsers.
- No core workflow depends on Redis or a persistent queue worker.
- Backup and restoration instructions are verified.
- The clinic has reviewed the workflows and approved the pilot.

## 16. Future expansion path

After the MVP is used successfully, consider adding modules in this order based on customer demand:

1. Pharmacy inventory and dispensing
2. Laboratory orders and results
3. WhatsApp/SMS reminders
4. IPD admissions, beds, nursing, and discharge
5. Multi-clinic SaaS tenant management
6. Native mobile applications and additional integrations

Do not include these future features in the initial budget unless separately approved.

---

## Companion file

Use `google-stitch-prompt.md` as the separate prompt to generate the UI templates. Treat Stitch as the design source: export/recreate its output in the actual React + MUI project, map every screen to routes and components, and replace mock data with Laravel API calls. A generated design is not an integrated or production-ready application by itself.
