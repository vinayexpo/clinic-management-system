export const WHATSAPP_EVENT_LABELS: Record<string, string> = {
  appointment_confirmation: "Appointment confirmed",
  appointment_reminder: "Appointment reminder",
  appointment_cancelled: "Appointment cancelled",
  appointment_rescheduled: "Appointment rescheduled",
  prescription_ready: "Prescription ready",
  payment_receipt: "Payment receipt",
  manual: "Manual message",
};

export const WHATSAPP_VARIABLES = [
  "patient_name", "clinic_name", "doctor_name", "appointment_date", "appointment_time",
  "reason", "portal_link", "invoice_number", "amount", "message",
];

export const WHATSAPP_SYNC_LABELS: Record<string, string> = {
  local: "Local only",
  synced: "Synced with Meta",
  draft: "Clinic draft",
  conflict: "Conflict",
  pending: "Awaiting approval",
  uncertain: "Unconfirmed submit",
  missing: "Missing in Meta",
};

export function syncColor(state: string): "success" | "warning" | "error" | "info" | "default" {
  if (state === "synced") return "success";
  if (state === "conflict" || state === "missing") return "error";
  if (state === "pending" || state === "uncertain") return "warning";
  if (state === "draft") return "info";
  return "default";
}

export function metaStatusColor(status: string | null): "success" | "warning" | "error" | "default" {
  if (status === "APPROVED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "REJECTED" || status === "PAUSED" || status === "DISABLED") return "error";
  return "default";
}

/** International form of a phone number, matching the server's Phone helper. */
export function toE164(raw: string | null | undefined, countryCode = "91"): string | null {
  let digits = (raw ?? "").replace(/\D+/g, "");
  const code = countryCode.replace(/\D+/g, "") || "91";
  if (digits.length === 12 && digits.startsWith(code)) digits = digits.slice(code.length);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length < 8) return null;
  return `+${code}${digits}`;
}

/** WhatsApp click-to-chat link: opens the chat with the message typed out. */
export function whatsappChatLink(phone: string | null | undefined, text: string, countryCode = "91"): string | null {
  const e164 = toE164(phone, countryCode);
  if (!e164) return null;
  const base = `https://wa.me/${e164.replace("+", "")}`;
  return text.trim() ? `${base}?text=${encodeURIComponent(text.trim())}` : base;
}

/** "Hello Asha" for the patient a message is addressed to. */
export function greeting(patient: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  const name = [patient?.first_name, patient?.last_name].filter(Boolean).join(" ");
  return name ? `Hello ${name}` : "Hello";
}

/** Plain opening line used when there is no record-specific detail to send. */
export function generalMessage(patient: { first_name?: string | null; last_name?: string | null } | null | undefined, clinicName: string): string {
  return `${greeting(patient)}, a message from ${clinicName || "the clinic"}.`;
}

/** Appointment details, as filled in on the appointment. */
export function appointmentMessage(
  patient: { first_name?: string | null; last_name?: string | null } | null | undefined,
  clinicName: string,
  appointment: { appointment_date?: string | null; start_time?: string | null; reason_for_visit?: string | null; doctor?: { display_name?: string | null } | null },
): string {
  const date = appointment.appointment_date ? String(appointment.appointment_date).slice(0, 10) : "";
  const time = appointment.start_time ? String(appointment.start_time).slice(0, 5) : "";
  const doctor = appointment.doctor?.display_name ?? "our doctor";
  const parts = [`${greeting(patient)}, this is ${clinicName || "the clinic"}.`];
  if (date || time) {
    parts.push(`Your appointment with ${doctor} is on ${date}${time ? ` at ${time}` : ""}.`);
  } else {
    parts.push(`Your appointment with ${doctor} is scheduled.`);
  }
  if (appointment.reason_for_visit) {
    parts.push(`Reason for visit: ${appointment.reason_for_visit}.`);
  }
  return parts.join(" ");
}

/** Prescription ready notice. */
export function prescriptionMessage(
  patient: { first_name?: string | null; last_name?: string | null } | null | undefined,
  clinicName: string,
  prescription: { prescription_number?: string | null },
  portalUrl: string,
): string {
  return `${greeting(patient)}, this is ${clinicName || "the clinic"}. Your prescription ${prescription.prescription_number ?? ""} is ready. View it at ${portalUrl}.`;
}

/** Payment received notice. */
export function invoiceMessage(
  patient: { first_name?: string | null; last_name?: string | null } | null | undefined,
  clinicName: string,
  invoice: { invoice_number?: string | null; total_amount?: string | number | null },
): string {
  return `${greeting(patient)}, this is ${clinicName || "the clinic"}. We received ${invoice.total_amount ?? ""} against invoice ${invoice.invoice_number ?? ""}. Thank you.`;
}
