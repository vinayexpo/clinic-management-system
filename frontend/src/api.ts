/** Minimum password length. Must match the backend validation rules (min:8). */
export const PASSWORD_MIN = 8;

const RAW_BASE = (import.meta.env.VITE_API_BASE as string | undefined)
  || "http://localhost:8000/api/v1";
export const API_BASE = RAW_BASE.replace(/\/+$/, "");

function qs(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== null);
  if (!entries.length) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

function authHeader(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function buildUrl(endpoint: string): string {
  // accept "/patients" or "patients?x=2" — normalize to API_BASE + "/" + endpoint
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${API_BASE}${path}`;
}

async function parseErr(res: Response): Promise<string> {
  const body = await res.text();
  if (!body) return `Request failed (${res.status})`;
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const msg = j["message"] as string | undefined;
    if (msg) return msg;
    const errs = j["errors"] as Record<string, string[]> | undefined;
    if (errs) return Object.values(errs).flat().join(" · ");
    return body.slice(0, 400);
  } catch { return body.slice(0, 400); }
}

export type ApiList<T> = { data: T[]; links?: unknown; meta?: unknown };
export type ApiItem<T> = { data: T };

export async function apiFetchRaw(
  endpoint: string,
  init: RequestInit = {},
  token?: string,
): Promise<Response> {
  const extra = init.headers as Record<string, string> | undefined;
  const isForm = init.body instanceof FormData;
  const res = await fetch(buildUrl(endpoint), {
    ...init,
    headers: {
      // Multipart bodies need the browser to set the boundary; never force JSON there.
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      Accept: "application/json",
      ...authHeader(token),
      ...(extra ?? {}),
    },
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("clinic:session-expired"));
  }
  if (!res.ok) throw new Error(await parseErr(res));
  return res;
}

/** Build a multipart body from plain fields plus an optional file (undefined = omit, null = remove flag). */
export function toFormData(fields: Record<string, unknown>, file?: File | null): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    fd.append(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  }
  if (file) fd.append("avatar", file);
  return fd;
}

/** Fetch a private avatar (authenticated) and return an object URL usable in <img src>. */
export async function fetchAvatarUrl(endpoint: string, token: string): Promise<string | null> {
  try {
    const res = await apiFetchRaw(endpoint, { method: "GET" }, token);
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

export async function apiJson<T>(endpoint: string, init: RequestInit = {}, token?: string): Promise<T> {
  const res = await apiFetchRaw(endpoint, init, token);
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

export async function apiBlob(endpoint: string, init: RequestInit = {}, token?: string): Promise<Blob> {
  return apiFetchRaw(endpoint, init, token).then((r) => r.blob());
}

// ---- Typed contracts matching Laravel responses/enums ----

export type UserRole = "admin" | "doctor" | "receptionist" | "patient";
export interface DoctorProfile { id: number; display_name: string; qualification?: string | null; specialization?: string | null; registration_number?: string | null; consultation_fee: string | number; is_active: boolean; }
export interface ApiUser { id: number; name: string; email: string; phone?: string | null; role: UserRole; is_active: boolean; has_avatar: boolean; last_login_at?: string | null; created_at?: string; doctor?: DoctorProfile | null; }
export interface DoctorRow { id: number; user_id?: number | null; display_name: string; qualification?: string | null; specialization?: string | null; registration_number?: string | null; consultation_fee: string | number; is_active: boolean; user?: ApiUser | null; schedules?: DoctorScheduleRow[]; }
export interface DoctorScheduleRow { id: number; doctor_id: number; day_of_week: number; start_time: string; end_time: string; is_active: boolean; }
export interface PatientRow {
  id: number; patient_number: string; first_name: string; last_name?: string | null;
  date_of_birth?: string | null; sex?: string | null; phone: string; email?: string | null;
  address?: string | null; emergency_contact_name?: string | null; emergency_contact_phone?: string | null;
  allergies_summary?: string | null; created_by?: number | null; visits_count?: number;
  has_avatar: boolean;
  deleted_at?: string | null;
  has_login: boolean;
  whatsapp_opt_in: boolean;
  login_phone?: string | null;
  user_id?: number | null;
  created_at?: string; updated_at?: string;
}
export interface DuplicatePatientMatch {
  id: number; patient_number: string; first_name: string; last_name?: string | null;
  phone: string; date_of_birth?: string | null; created_at?: string; match_reasons: string[];
}
export interface VisitAmendmentRow {
  id: number; visit_id: number; user_id?: number | null; doctor_id?: number | null;
  reason: string; notes: string; created_at: string; updated_at?: string;
  user?: ApiUser | null; doctor?: DoctorRow | null;
}
export interface AppointmentRow {
  id: number; appointment_number: string; patient_id: number; doctor_id: number;
  appointment_date: string; start_time: string; end_time?: string | null;
  visit_type: string; token_number?: number | null; status: "booked" | "waiting" | "in_consultation" | "completed" | "cancelled" | "no_show";
  reason_for_visit?: string | null; cancel_reason?: string | null; created_by?: number | null;
  patient?: PatientRow | null; doctor?: DoctorRow | null;
}
export interface VisitRow {
  id: number; visit_number: string; patient_id: number; appointment_id?: number | null; doctor_id: number;
  visit_date: string; symptoms?: string | null; vitals?: Record<string, unknown> | null;
  examination_notes?: string | null; diagnosis?: string | null; treatment_plan?: string | null;
  follow_up_date?: string | null; status: "draft" | "finalized" | "amended"; finalized_at?: string | null;
  patient?: PatientRow | null; doctor?: DoctorRow | null; prescriptions?: PrescriptionRow[] | null;
  amendments?: VisitAmendmentRow[] | null; invoices?: InvoiceRow[] | null;
}
export interface PrescriptionRow {
  id: number; prescription_number: string; visit_id: number; patient_id: number; doctor_id: number;
  issued_at?: string | null; instructions?: string | null; status: "draft" | "finalized" | "cancelled";
  items?: PrescriptionItemRow[]; patient?: PatientRow | null; doctor?: DoctorRow | null; visit?: VisitRow | null;
}
export interface PrescriptionItemRow {
  id: number; prescription_id: number; medicine_name: string; strength?: string | null; dosage: string;
  route?: string | null; frequency: string; duration: string; quantity?: number | null; instructions?: string | null; sort_order: number;
}
export interface InvoiceRow {
  id: number; invoice_number: string; patient_id: number; visit_id?: number | null;
  invoice_date: string; subtotal: string | number; discount_amount: string | number; total_amount: string | number;
  status: "unpaid" | "partially_paid" | "paid" | "void"; notes?: string | null; created_by?: number | null;
  patient?: PatientRow | null; visit?: VisitRow | null; items?: InvoiceItemRow[]; payments?: PaymentRow[];
  paid_amount?: string | number; balance?: string | number;
}
export interface InvoiceItemRow { id: number; invoice_id: number; description: string; quantity: string | number; unit_price: string | number; line_total: string | number; }
export interface PaymentRow {
  id: number; payment_number: string; invoice_id: number; amount: string | number;
  payment_method: "cash" | "upi" | "card" | "bank_transfer" | "other";
  transaction_reference?: string | null; paid_at: string; received_by?: number | null;
  status: "completed" | "reversed" | "refunded"; entry_type: string; reversal_of_id?: number | null; notes?: string | null;
}
export interface ClinicSettingRow {
  id?: number; clinic_name: string; address?: string | null; phone?: string | null; email?: string | null;
  logo_path?: string | null; timezone: string; working_hours?: Record<string, unknown> | null;
  appointment_slot_minutes: number; prescription_footer?: string | null; invoice_prefix: string; receipt_prefix: string;
  theme?: { primary: string; accent: string; background: string; surface: string } | null;
}
export interface DashboardSummary {
  appointments_today: number; waiting_queue: number; completed_consultations: number | null;
  collections_today: number | string | null; outstanding: number | string | null;
}
export interface AuditRow { id: number; user_id?: number | null; action: string; entity_type: string; entity_id?: number | null; summary: string; ip_address?: string | null; user_agent?: string | null; created_at: string; user?: ApiUser | null; }

export interface NotificationRow {
  id: string;
  title: string;
  body: string;
  type: string;
  page: string;
  entity_id?: number | null;
  read_at?: string | null;
  created_at?: string | null;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  content_encoding?: string;
}

// ---- Domain helpers (query-aware) ----

// ---- First-run setup (signup only while no admin exists) ----

export interface PageMeta { current_page: number; last_page: number; per_page: number; total: number; }
export interface Paginated<T> extends PageMeta { data: T[]; }
export interface ListParams {
  page?: number;
  per_page?: number;
  search?: string;
  sort?: string;
  direction?: "asc" | "desc";
  [key: string]: string | number | boolean | undefined;
}

/** Plain-number page shorthand used by older call sites. */
export type PageArg = number | ListParams;
const asParams = (p?: PageArg): ListParams | undefined => (typeof p === "number" ? { page: p } : p);

export const setupApi = {
  status() { return apiJson<ApiItem<{ needs_setup: boolean; clinic_name?: string | null; has_logo?: boolean; theme?: { primary: string; accent: string; background: string; surface: string } | null }>>("/setup/status", {}, ""); },
  createAdmin(data: { name: string; email: string; phone?: string; password: string; password_confirmation: string }) {
    return apiJson<ApiItem<{ user: ApiUser; token: string }>>("/setup/admin", { method: "POST", body: JSON.stringify(data) }, "");
  },
};

/**
 * The clinic logo for the sign-in screen.
 *
 * Public, so it works before anyone signs in. Returns an object URL, or null
 * when the clinic has no logo.
 */
export async function fetchClinicLogo(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/clinic/logo`, { cache: "no-store" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size > 0 ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

export const authApi = {
  /** Staff sign in with email; patients sign in with their registered phone number. */
  login(identifier: string, password: string) {
    return apiJson<ApiItem<{ user: ApiUser; token: string }>>("/login", { method: "POST", body: JSON.stringify({ login: identifier, password }) });
  },
  logout(token: string) {
    return apiJson<ApiItem<{ message: string }>>("/logout", { method: "POST" }, token);
  },
  me(token: string) {
    return apiJson<ApiItem<ApiUser>>("/me", {}, token);
  },
  /** Staff edit their own profile: display name, phone and photo. */
  updateMe(token: string, fields: Record<string, unknown>, file?: File | null) {
    return apiJson<ApiItem<ApiUser>>("/me", { method: "PUT", body: toFormData(fields, file) }, token);
  },
};

/** Portal (patient role): the signed-in patient's own data. No patient id is ever sent. */
export const portalApi = {
  me(token: string) { return apiJson<ApiItem<PatientRow & { visits_count?: number }>>("/portal/me", {}, token); },
  /** A patient may change their own photo; other details stay with the front desk. */
  updateMe(token: string, fields: Record<string, unknown>, file?: File | null) {
    return apiJson<ApiItem<PatientRow & { visits_count?: number }>>("/portal/me", { method: "PUT", body: toFormData(fields, file) }, token);
  },
  visits(token: string, params?: PageArg) { return apiJson<ApiItem<Paginated<VisitRow>>>(`/portal/visits${qs(asParams(params))}`, {}, token); },
  visit(token: string, id: number) { return apiJson<ApiItem<VisitRow>>(`/portal/visits/${id}`, {}, token); },
  appointments(token: string, params?: PageArg) { return apiJson<ApiItem<Paginated<AppointmentRow>>>(`/portal/appointments${qs(asParams(params))}`, {}, token); },
  bookAppointment(token: string, data: { doctor_id: number; appointment_date: string; start_time: string; reason_for_visit?: string }) {
    return apiJson<ApiItem<AppointmentRow>>("/portal/appointments", { method: "POST", body: JSON.stringify(data) }, token);
  },
  cancelAppointment(token: string, appointmentId: number, reason?: string) {
    return apiJson<ApiItem<AppointmentRow>>(`/portal/appointments/${appointmentId}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }, token);
  },
  prescriptions(token: string, params?: PageArg) { return apiJson<ApiItem<Paginated<PrescriptionRow>>>(`/portal/prescriptions${qs(asParams(params))}`, {}, token); },
  prescription(token: string, id: number) { return apiJson<ApiItem<PrescriptionRow>>(`/portal/prescriptions/${id}`, {}, token); },
  printPrescription(token: string, id: number) {
    return apiJson<ApiItem<{ prescription: PrescriptionRow; clinic: { clinic_name?: string; address?: string; phone?: string; prescription_footer?: string; logo_data_uri?: string | null } | null; printable: boolean }>>(`/portal/prescriptions/${id}/print`, {}, token);
  },
  invoices(token: string, params?: PageArg) { return apiJson<ApiItem<Paginated<InvoiceRow>>>(`/portal/invoices${qs(asParams(params))}`, {}, token); },
  invoice(token: string, id: number) { return apiJson<ApiItem<InvoiceRow>>(`/portal/invoices/${id}`, {}, token); },
  printInvoice(token: string, id: number) {
    return apiJson<ApiItem<{ invoice: InvoiceRow; clinic: { clinic_name?: string; address?: string; phone?: string; logo_data_uri?: string | null } | null }>>(`/portal/invoices/${id}/receipt`, {}, token);
  },
};

export interface PhotoRow {
  type: "staff" | "patient";
  id: number;
  name: string;
  detail: string;
  has_photo: boolean;
  updated_at: string | null;
}

export const photoApi = {
  list(token: string, params?: { type?: string; search?: string; has_photo?: string; per_page?: number; page?: number }) {
    return apiJson<ApiItem<Paginated<PhotoRow>>>(`/photos${qs(params)}`, {}, token);
  },
  replace(token: string, type: string, id: number, file: File) {
    const body = new FormData();
    body.append("avatar", file);
    return apiJson<ApiItem<{ type: string; id: number; has_photo: boolean }>>(`/photos/${type}/${id}`, { method: "POST", body }, token);
  },
  remove(token: string, type: string, id: number) {
    return apiJson<ApiItem<{ type: string; id: number; has_photo: boolean }>>(`/photos/${type}/${id}`, { method: "DELETE" }, token);
  },
};

export const patientApi = {
  list(token: string, params?: number | (ListParams & { sex?: string; has_allergies?: boolean; date_from?: string; date_to?: string; has_login?: boolean })) {
    return apiJson<ApiItem<Paginated<PatientRow>>>(`/patients${qs(asParams(params))}`, {}, token);
  },
  get(token: string, id: number | string) {
    return apiJson<ApiItem<PatientRow & { visits: VisitRow[]; appointments: AppointmentRow[] }>>(`/patients/${id}`, {}, token);
  },
  create(token: string, data: Partial<PatientRow>, avatar?: File | null) {
    return apiJson<ApiItem<PatientRow>>("/patients", { method: "POST", body: toFormData(data as Record<string, unknown>, avatar) }, token);
  },
  update(token: string, id: number | string, data: Partial<PatientRow>, avatar?: File | null, removeAvatar = false) {
    // POST + _method spoof-free route: backend accepts POST for multipart updates.
    return apiJson<ApiItem<PatientRow>>(`/patients/${id}`, { method: "POST", body: toFormData({ ...data, remove_avatar: removeAvatar }, avatar) }, token);
  },
  remove(token: string, id: number | string) {
    return apiJson<ApiItem<{ message: string }>>(`/patients/${id}`, { method: "DELETE" }, token);
  },
  avatarEndpoint(id: number | string) { return `/patients/${id}/avatar`; },
  resetPortalPassword(token: string, id: number | string, password: string) {
    return apiJson<ApiItem<{ message: string }>>(`/patients/${id}/portal-password`, { method: "POST", body: JSON.stringify({ password }) }, token);
  },
  visits(token: string, patientId: number | string, params?: PageArg) {
    return apiJson<ApiItem<Paginated<VisitRow>>>(`/patients/${patientId}/visits${qs(asParams(params))}`, {}, token);
  },
  appointments(token: string, patientId: number | string, params?: PageArg) {
    return apiJson<ApiItem<Paginated<AppointmentRow>>>(`/patients/${patientId}/appointments${qs(asParams(params))}`, {}, token);
  },
  checkDuplicates(token: string, params: { phone?: string; first_name?: string; last_name?: string; date_of_birth?: string; exclude_id?: number }) {
    return apiJson<ApiItem<{ duplicates: DuplicatePatientMatch[] }>>(`/patients/check-duplicates${qs(params)}`, {}, token);
  },
};

export const doctorApi = {
  list(token: string, params?: number | (ListParams & { active?: boolean; all?: boolean })) {
    return apiJson<ApiItem<Paginated<DoctorRow>> | ApiItem<DoctorRow[]>>(`/doctors${qs(asParams(params))}`, {}, token);
  },
  get(token: string, id: number | string) { return apiJson<ApiItem<DoctorRow>>(`/doctors/${id}`, {}, token); },
  availability(token: string, id: number | string, date?: string) {
    return apiJson<ApiItem<{ date: string; day_of_week: number; schedules: DoctorScheduleRow[]; appointments: AppointmentRow[] }>>(`/doctors/${id}/availability${qs({ date })}`, {}, token);
  },
  schedules(token: string, id: number | string) { return apiJson<ApiItem<DoctorScheduleRow[]>>(`/doctors/${id}/schedules`, {}, token); },
  /** Replace the doctor's whole weekly schedule. Empty array clears it. Server validates overlaps. */
  replaceSchedule(token: string, doctorId: number | string, blocks: { day_of_week: number; start_time: string; end_time: string }[]) {
    return apiJson<ApiItem<DoctorScheduleRow[]>>(`/doctors/${doctorId}/schedules`, { method: "PUT", body: JSON.stringify({ blocks }) }, token);
  },
  createSchedule(token: string, doctorId: number | string, data: Partial<DoctorScheduleRow>) {
    return apiJson<ApiItem<DoctorScheduleRow>>(`/doctors/${doctorId}/schedules`, { method: "POST", body: JSON.stringify(data) }, token);
  },
  updateSchedule(token: string, scheduleId: number | string, data: Partial<DoctorScheduleRow>) {
    return apiJson<ApiItem<DoctorScheduleRow>>(`/doctor-schedules/${scheduleId}`, { method: "PUT", body: JSON.stringify(data) }, token);
  },
  deleteSchedule(token: string, scheduleId: number | string) {
    return apiJson<ApiItem<{ message: string }>>(`/doctor-schedules/${scheduleId}`, { method: "DELETE" }, token);
  },
};

export const appointmentApi = {
  list(token: string, params?: number | (ListParams & { date?: string; date_from?: string; date_to?: string; status?: string; doctor_id?: number; visit_type?: string })) {
    return apiJson<ApiItem<Paginated<AppointmentRow>>>(`/appointments${qs(asParams(params))}`, {}, token);
  },
  get(token: string, id: number | string) {
    return apiJson<ApiItem<AppointmentRow & { visit?: VisitRow | null }>>(`/appointments/${id}`, {}, token);
  },
  create(token: string, data: Record<string, unknown>) {
    return apiJson<ApiItem<AppointmentRow>>("/appointments", { method: "POST", body: JSON.stringify(data) }, token);
  },
  walkIn(token: string, data: Record<string, unknown>) {
    return apiJson<ApiItem<AppointmentRow>>("/walk-ins", { method: "POST", body: JSON.stringify(data) }, token);
  },
  update(token: string, id: number | string, data: Record<string, unknown>) {
    return apiJson<ApiItem<AppointmentRow>>(`/appointments/${id}`, { method: "PUT", body: JSON.stringify(data) }, token);
  },
  cancel(token: string, id: number | string, cancel_reason: string) {
    return apiJson<ApiItem<AppointmentRow>>(`/appointments/${id}/cancel`, { method: "POST", body: JSON.stringify({ cancel_reason }) }, token);
  },
  setStatus(token: string, id: number | string, status: AppointmentRow["status"], cancel_reason?: string) {
    return apiJson<ApiItem<AppointmentRow>>(`/appointments/${id}/status`, { method: "POST", body: JSON.stringify({ status, cancel_reason }) }, token);
  },
};

export const visitApi = {
  list(token: string, params?: number | (ListParams & { status?: string; doctor_id?: number; patient_id?: number; date_from?: string; date_to?: string })) {
    return apiJson<ApiItem<Paginated<VisitRow>>>(`/visits${qs(asParams(params))}`, {}, token);
  },
  get(token: string, id: number | string) { return apiJson<ApiItem<VisitRow>>(`/visits/${id}`, {}, token); },
  create(token: string, data: Record<string, unknown>) {
    return apiJson<ApiItem<VisitRow>>("/visits", { method: "POST", body: JSON.stringify(data) }, token);
  },
  update(token: string, id: number | string, data: Record<string, unknown>) {
    return apiJson<ApiItem<VisitRow>>(`/visits/${id}`, { method: "PUT", body: JSON.stringify(data) }, token);
  },
  finalize(token: string, id: number | string) {
    return apiJson<ApiItem<VisitRow>>(`/visits/${id}/finalize`, { method: "POST" }, token);
  },
  amend(token: string, id: number | string, data: { reason: string; notes: string }) {
    return apiJson<ApiItem<VisitAmendmentRow>>(`/visits/${id}/amendments`, { method: "POST", body: JSON.stringify(data) }, token);
  },
  createPrescription(token: string, visitId: number | string, data: { instructions?: string; items: Partial<PrescriptionItemRow>[] }) {
    return apiJson<ApiItem<PrescriptionRow>>(`/visits/${visitId}/prescriptions`, { method: "POST", body: JSON.stringify(data) }, token);
  },
};

export const prescriptionApi = {
  list(token: string, params?: number | (ListParams & { status?: PrescriptionRow["status"]; patient_id?: number; doctor_id?: number; date_from?: string; date_to?: string })) {
    return apiJson<ApiItem<Paginated<PrescriptionRow>>>(`/prescriptions${qs(asParams(params))}`, {}, token);
  },
  get(token: string, id: number | string) { return apiJson<ApiItem<PrescriptionRow>>(`/prescriptions/${id}`, {}, token); },
  update(token: string, id: number | string, data: { instructions?: string | null; items?: Partial<PrescriptionItemRow>[] }) {
    return apiJson<ApiItem<PrescriptionRow>>(`/prescriptions/${id}`, { method: "PUT", body: JSON.stringify(data) }, token);
  },
  remove(token: string, id: number | string) {
    return apiJson<ApiItem<{ message: string }>>(`/prescriptions/${id}`, { method: "DELETE" }, token);
  },
  finalize(token: string, id: number | string) {
    return apiJson<ApiItem<PrescriptionRow>>(`/prescriptions/${id}/finalize`, { method: "POST" }, token);
  },
  print(token: string, id: number | string) {
    return apiJson<ApiItem<{ prescription: PrescriptionRow; clinic: ClinicSettingRow | null; printable: boolean }>>(`/prescriptions/${id}/print`, {}, token);
  },
};

export const invoiceApi = {
  list(token: string, params?: number | (ListParams & { status?: string; patient_id?: number; date_from?: string; date_to?: string })) {
    return apiJson<ApiItem<Paginated<InvoiceRow>>>(`/invoices${qs(asParams(params))}`, {}, token);
  },
  get(token: string, id: number | string) { return apiJson<ApiItem<InvoiceRow>>(`/invoices/${id}`, {}, token); },
  create(token: string, data: Record<string, unknown>) {
    return apiJson<ApiItem<InvoiceRow>>("/invoices", { method: "POST", body: JSON.stringify(data) }, token);
  },
  /** Edit an invoice that has no recorded payments. */
  update(token: string, id: number | string, data: Record<string, unknown>) {
    return apiJson<ApiItem<InvoiceRow>>(`/invoices/${id}`, { method: "PUT", body: JSON.stringify(data) }, token);
  },
  void(token: string, id: number | string) {
    return apiJson<ApiItem<InvoiceRow>>(`/invoices/${id}/void`, { method: "POST" }, token);
  },
  pay(token: string, invoiceId: number | string, data: { amount: number; payment_method: PaymentRow["payment_method"]; transaction_reference?: string; notes?: string }) {
    return apiJson<ApiItem<PaymentRow>>(`/invoices/${invoiceId}/payments`, { method: "POST", body: JSON.stringify(data) }, token);
  },
  receipt(token: string, id: number | string) {
    return apiJson<ApiItem<{ invoice: InvoiceRow; clinic: ClinicSettingRow | null }>>(`/invoices/${id}/receipt`, {}, token);
  },
};

export const paymentApi = {
  reverse(token: string, paymentId: number | string) {
    return apiJson<ApiItem<PaymentRow>>(`/payments/${paymentId}/reverse`, { method: "POST" }, token);
  },
  refund(token: string, paymentId: number | string, data?: { amount?: number; notes?: string }) {
    return apiJson<ApiItem<PaymentRow>>(`/payments/${paymentId}/refund`, { method: "POST", body: JSON.stringify(data ?? {}) }, token);
  },
};

export const reportApi = {
  fetch(token: string, report: "collections" | "appointments" | "patients" | "doctor-consultations", params?: { from?: string; to?: string }) {
    return apiJson<ApiItem<unknown>>(`/reports/${report}${qs(params)}`, {}, token);
  },
  csvUrl(report: string, params?: { from?: string; to?: string }) {
    return `${API_BASE}/reports/${report}${qs({ ...params, format: "csv" })}`;
  },
};

export const dashboardApi = {
  summary(token: string) { return apiJson<ApiItem<DashboardSummary>>("/dashboard/summary", {}, token); },
};

export const clinicApi = {
  status(token: string) { return apiJson<ApiItem<Pick<ClinicSettingRow, "clinic_name" | "address" | "phone" | "timezone" | "working_hours">>>("/clinic/status", {}, token); },
  get(token: string) { return apiJson<ApiItem<ClinicSettingRow>>("/settings/clinic", {}, token); },
  update(token: string, data: Partial<ClinicSettingRow> & { theme?: ClinicSettingRow["theme"] }) {
    return apiJson<ApiItem<ClinicSettingRow>>("/settings/clinic", { method: "PUT", body: JSON.stringify(data) }, token);
  },
  /** Upload the clinic logo. Administrators only. */
  uploadLogo(token: string, file: File) {
    const body = new FormData();
    body.append("logo", file);
    return apiJson<ApiItem<ClinicSettingRow>>("/settings/clinic/logo", { method: "POST", body }, token);
  },
  /** Remove the clinic logo. Administrators only. */
  deleteLogo(token: string) {
    return apiJson<ApiItem<ClinicSettingRow>>("/settings/clinic/logo", { method: "DELETE" }, token);
  },
  /** The logo image bytes, for the settings preview. */
  logoBlob(token: string) {
    return apiBlob("/settings/clinic/logo", { method: "GET" }, token);
  },
};

export interface StaffInput {
  name: string; email: string; phone?: string; password?: string; role: UserRole; is_active?: boolean;
  qualification?: string; specialization?: string; registration_number?: string; consultation_fee?: number;
}

export const userApi = {
  list(token: string, params?: number | (ListParams & { role?: UserRole; is_active?: boolean; specialization?: string })) {
    return apiJson<ApiItem<Paginated<ApiUser>>>(`/users${qs(asParams(params))}`, {}, token);
  },
  get(token: string, id: number | string) {
    return apiJson<ApiItem<ApiUser & { doctor?: DoctorProfile | null }>>(`/users/${id}`, {}, token);
  },
  create(token: string, data: StaffInput, avatar?: File | null) {
    return apiJson<ApiItem<ApiUser>>("/users", { method: "POST", body: toFormData(data as unknown as Record<string, unknown>, avatar) }, token);
  },
  update(token: string, id: number | string, data: Partial<StaffInput>, avatar?: File | null, removeAvatar = false) {
    return apiJson<ApiItem<ApiUser>>(`/users/${id}`, { method: "POST", body: toFormData({ ...data, remove_avatar: removeAvatar }, avatar) }, token);
  },
  deactivate(token: string, id: number | string) {
    return apiJson<ApiItem<{ message: string }>>(`/users/${id}`, { method: "DELETE" }, token);
  },
  reactivate(token: string, id: number | string) {
    return apiJson<ApiItem<ApiUser>>(`/users/${id}/reactivate`, { method: "POST" }, token);
  },
  avatarEndpoint(id: number | string) { return `/users/${id}/avatar`; },
};

export interface WhatsAppBinding {
  key: string;
  variable: string;
}

export interface WhatsAppTemplateRow {
  event: string;
  template_name: string;
  body: string;
  is_active: boolean;
  revision: number;
  sync_state: string;
  meta_template_id: string | null;
  meta_status: string | null;
  meta_missing: boolean;
  language: string;
  last_synced_at: string | null;
  bindings: WhatsAppBinding[];
  placeholders: string[];
  media_url: string | null;
  header_type: string | null;
  buttons: WhatsAppMetaButton[];
  sync_error: string | null;
}

export interface WhatsAppMetaButton {
  type: string;
  text: string;
  url: string;
  has_parameter: boolean;
}

export interface WhatsAppMetaTemplateRow {
  id: number;
  meta_id: string;
  name: string;
  language: string;
  category: string | null;
  status: string | null;
  parameter_format: string | null;
  body: string | null;
  footer: string | null;
  placeholders: string[];
  header_type: string | null;
  header_example: string | null;
  buttons: WhatsAppMetaButton[];
  button_parameter_count: number;
  supported: boolean;
  unsupported_reason: string | null;
  missing: boolean;
  last_synced_at: string | null;
  linked_event: string | null;
}

export interface WhatsAppMetaCatalog {
  configured: boolean;
  last_pulled_at: string | null;
  variables: string[];
  locals: WhatsAppTemplateRow[];
  templates: WhatsAppMetaTemplateRow[];
}

export interface WhatsAppStatus {
  enabled: boolean;
  log_only: boolean;
  configured: boolean;
  phone_number_id: string | null;
  reminder_lead_hours: number;
  country_code: string;
  templates: WhatsAppTemplateRow[];
  coexistence: {
    ready: boolean;
    webhook_url: string;
    required_webhook_fields: string[];
    connection: {
      status: string;
      display_phone_number: string;
      connected_at: string;
      last_webhook_at: string | null;
      history_status: string;
      sync_progress: number;
      contacts_sync_request_id: string | null;
      history_sync_request_id: string | null;
    } | null;
  };
  sender: {
    source: "coexistence" | "standard" | null;
    phone_number: string | null;
    coexistence_connected: boolean;
  };
}

export interface WhatsAppSignupAttempt {
  state: string;
  app_id: string;
  config_id: string;
  graph_version: string;
}

export interface WhatsAppSyncEvent {
  id: number;
  field: string;
  received_at: string;
  message_count: number;
  contact_count: number;
  status_count: number;
  messages: { direction: "incoming" | "outgoing"; peer_number: string | null; body: string | null; type: string | null }[];
}

export interface WhatsAppMessageRow {
  id: number;
  patient_id: number | null;
  appointment_id: number | null;
  event: string;
  to_number: string;
  rendered_body: string;
  parameters: string[] | null;
  status: "pending" | "sent" | "logged" | "failed" | "skipped";
  error: string | null;
  provider_message_id: string | null;
  sent_at: string | null;
  created_at: string;
  patient?: PatientRow | null;
}

export interface WhatsAppSenderState {
  source: "coexistence" | "standard" | null;
  phone_number: string | null;
  coexistence_connected: boolean;
  country_code: string;
}

export const whatsappApi = {
  /** Which WhatsApp account staff should use right now. */
  sender(token: string) {
    return apiJson<ApiItem<WhatsAppSenderState>>("/whatsapp/sender", {}, token);
  },
  syncEvents(token: string, page = 1) {
    return apiJson<ApiItem<Paginated<WhatsAppSyncEvent>>>(`/whatsapp/coexistence/events${qs({ page, per_page: 10 })}`, {}, token);
  },
  startCoexistence(token: string, phone: string, syncConsent: boolean) {
    return apiJson<ApiItem<WhatsAppSignupAttempt>>("/whatsapp/coexistence/start", {
      method: "POST", body: JSON.stringify({ phone, sync_consent: syncConsent }),
    }, token);
  },
  completeCoexistence(token: string, data: { state: string; code: string; waba_id: string }) {
    return apiJson<ApiItem<unknown>>("/whatsapp/coexistence/complete", { method: "POST", body: JSON.stringify(data) }, token);
  },
  status(token: string) {
    return apiJson<ApiItem<WhatsAppStatus>>("/whatsapp/status", {}, token);
  },
  updateTemplate(token: string, event: string, data: { template_name: string; body: string; is_active?: boolean; media_url?: string | null; expected_revision?: number }) {
    return apiJson<ApiItem<WhatsAppTemplateRow>>(`/whatsapp/templates/${event}`, { method: "PUT", body: JSON.stringify(data) }, token);
  },
  metaTemplates(token: string) {
    return apiJson<ApiItem<WhatsAppMetaCatalog>>("/whatsapp/meta-templates", {}, token);
  },
  pullMetaTemplates(token: string) {
    return apiJson<ApiItem<{ imported: number; updated: number; conflicts: number }>>("/whatsapp/meta-templates/pull", { method: "POST" }, token);
  },
  adoptTemplate(token: string, event: string, data: { meta_template_id: number; expected_revision: number; bindings: Record<string, string> }) {
    return apiJson<ApiItem<WhatsAppTemplateRow>>(`/whatsapp/templates/${event}/adopt`, { method: "POST", body: JSON.stringify(data) }, token);
  },
  /** Stop using a Meta template for this message type. The template stays in Meta. */
  unlinkTemplate(token: string, event: string) {
    return apiJson<ApiItem<WhatsAppTemplateRow>>(`/whatsapp/templates/${event}/link`, { method: "DELETE" }, token);
  },
  publishTemplate(token: string, event: string, data: { expected_revision: number; resolve?: "keep_local"; header?: { type: "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT"; sample: string } | null }) {
    return apiJson<ApiItem<{ template: WhatsAppTemplateRow; confirmed: boolean; message: string }>>(`/whatsapp/templates/${event}/publish`, { method: "POST", body: JSON.stringify(data) }, token);
  },
  preview(token: string, event: string) {
    return apiJson<ApiItem<{ body: string; parameters: string[] }>>(`/whatsapp/templates/${event}/preview`, {}, token);
  },
  sendTest(token: string, data: { phone: string; message: string }) {
    return apiJson<ApiItem<{ status: string; error: string | null }>>("/whatsapp/test", { method: "POST", body: JSON.stringify(data) }, token);
  },
  /** Send a one-off WhatsApp message to a patient, using the manual template. */
  sendToPatient(token: string, data: { patient_id: number; message: string }) {
    return apiJson<ApiItem<{ status: string; error: string | null }>>("/whatsapp/send", { method: "POST", body: JSON.stringify(data) }, token);
  },
  messages(token: string, params?: ListParams) {
    return apiJson<ApiItem<Paginated<WhatsAppMessageRow>>>(`/whatsapp/messages${qs(asParams(params))}`, {}, token);
  },
  patientMessages(token: string, patientId: number | string, page = 1) {
    return apiJson<ApiItem<Paginated<WhatsAppMessageRow>>>(`/patients/${patientId}/whatsapp-messages${qs({ page })}`, {}, token);
  },
  setConsent(token: string, patientId: number | string, optIn: boolean) {
    return apiJson<ApiItem<PatientRow>>(`/patients/${patientId}/whatsapp-consent`, { method: "PUT", body: JSON.stringify({ whatsapp_opt_in: optIn }) }, token);
  },
  remind(token: string, appointmentId: number | string) {
    return apiJson<ApiItem<{ status: string; error: string | null }>>(`/appointments/${appointmentId}/reminder`, { method: "POST" }, token);
  },
};

// ---- AI assistant (configured by an administrator, staff use drafts) ----

export type AiFeature = "consultation" | "prescription" | "patient_summary" | "assistant";
export type AiFeatureFlags = Record<AiFeature, boolean>;

/** What a staff member sees: is the clinic connected, and which features are on. */
export interface AiStatus {
  configured: boolean;
  model: string | null;
  provider_host: string | null;
  features: AiFeatureFlags;
}

/** The editable configuration for administrators; the key itself never leaves the server. */
export interface AiConfig {
  base_url: string | null;
  api_key_masked: string | null;
  has_api_key: boolean;
  model: string | null;
  features: AiFeatureFlags;
}

export interface AiModelRow { id: string; owned_by?: string | null }

/** Draft clinical fields for one visit; every value stays editable before use. */
export interface AiConsultDraft {
  examination_notes?: string;
  diagnosis?: string;
  treatment_plan?: string;
  follow_up_suggestion?: string;
  follow_up_date?: string;
}

export interface AiPrescriptionItem {
  medicine_name: string;
  strength: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: number | null;
  instructions: string;
}

export const aiApi = {
  /** Status for any staff member: configured? which model? which features are switched on. */
  status(token: string) { return apiJson<ApiItem<AiStatus>>("/ai/status", {}, token); },
  /** Saved provider configuration with a masked key. Administrators only. */
  config(token: string) { return apiJson<ApiItem<AiConfig>>("/ai/config", {}, token); },
  saveConfig(token: string, data: { base_url: string; api_key?: string; model: string; features?: Partial<AiFeatureFlags> }) {
    return apiJson<ApiItem<AiConfig>>("/ai/config", { method: "PUT", body: JSON.stringify(data) }, token);
  },
  /** Model catalogue from the configured provider, for the picker in Settings. */
  models(token: string, data: { api_url?: string; api_key?: string } = {}) {
    return apiJson<ApiItem<{ models: AiModelRow[]; resolved_url: string }>>("/ai/models", { method: "POST", body: JSON.stringify(data) }, token);
  },
  consultationDraft(token: string, visitId: number | string, data?: {
    instructions?: string;
    current_symptoms?: string;
    current_vitals?: Record<string, unknown>;
    current_exam?: string;
    current_diagnosis?: string;
    current_plan?: string;
  }) {
    return apiJson<ApiItem<AiConsultDraft>>("/ai/assist/consultation", {
      method: "POST",
      body: JSON.stringify({
        visit_id: visitId,
        ...(data || {}),
      }),
    }, token);
  },
  prescriptionDraft(token: string, visitId: number | string, instructions?: string) {
    return apiJson<ApiItem<{ items: AiPrescriptionItem[] }>>("/ai/assist/prescription", { method: "POST", body: JSON.stringify({ visit_id: visitId, instructions: instructions || undefined }) }, token);
  },
  patientSummary(token: string, patientId: number | string) {
    return apiJson<ApiItem<{ summary: string }>>("/ai/assist/patient-summary", { method: "POST", body: JSON.stringify({ patient_id: patientId }) }, token);
  },
  ask(token: string, data: { question: string; patient_id?: number; history?: { role: "user" | "assistant"; content: string }[] }) {
    return apiJson<ApiItem<{ answer: string; model: string }>>("/ai/ask", { method: "POST", body: JSON.stringify(data) }, token);
  },
};

export interface AuditOptions {
  actions: string[];
  entity_types: string[];
  users: { id: number; name: string; role: UserRole }[];
}

export const auditApi = {
  list(token: string, params: { page?: number; per_page?: number; search?: string; action?: string; entity_type?: string; user_id?: number; date_from?: string; date_to?: string } = {}) {
    return apiJson<ApiItem<Paginated<AuditRow>>>(`/audit-logs${qs(params)}`, {}, token);
  },
  options(token: string) {
    return apiJson<ApiItem<AuditOptions>>("/audit-logs/options", {}, token);
  },
};

export const notificationApi = {
  list(token: string, page = 1) {
    return apiJson<ApiItem<Paginated<NotificationRow>>>(`/notifications${qs({ page })}`, {}, token);
  },
  unreadCount(token: string) {
    return apiJson<ApiItem<{ unread: number }>>("/notifications/unread-count", {}, token);
  },
  markRead(token: string, id: string) {
    return apiJson<ApiItem<{ unread: number }>>(`/notifications/${id}/read`, { method: "POST" }, token);
  },
  markAllRead(token: string) {
    return apiJson<ApiItem<{ unread: number }>>("/notifications/read-all", { method: "POST" }, token);
  },
  remove(token: string, id: string) {
    return apiJson<ApiItem<{ message: string }>>(`/notifications/${id}`, { method: "DELETE" }, token);
  },
  pushKey(token: string) {
    return apiJson<ApiItem<{ public_key: string; enabled: boolean; subscribed: boolean }>>("/notifications/push/key", {}, token);
  },
  subscribePush(token: string, payload: PushSubscriptionPayload) {
    return apiJson<ApiItem<{ subscribed: boolean }>>("/notifications/push/subscribe", { method: "POST", body: JSON.stringify(payload) }, token);
  },
  unsubscribePush(token: string, endpoint: string) {
    return apiJson<ApiItem<{ subscribed: boolean }>>("/notifications/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }, token);
  },
};
