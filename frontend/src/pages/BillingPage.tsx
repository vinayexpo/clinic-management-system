import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import { IconPlus, IconPrinter } from "@tabler/icons-react";
import { invoiceApi, patientApi, paymentApi, visitApi, type InvoiceRow, type ListParams, type Paginated, type PatientRow, type PaymentRow, type UserRole, type VisitRow } from "../api";
import { FilterSelect, PagerBar, SearchField, useDebounced } from "../components/common";
import { WhatsAppButton } from "../components/WhatsAppButton";
import { getClinicDetails } from "../lib/clinicStore";
import { invoiceMessage } from "../lib/whatsapp";
import { istDate } from "../lib/ist";
import { useLiveRefresh } from "../lib/realtime";

const money = (value: string | number) => `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
const patientName = (p?: PatientRow | null) => p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "Patient record";
/** A deleted patient still belongs on the invoice, marked so nobody confuses it with a live record. */
const patientCell = (p?: PatientRow | null) => p ? `${patientName(p)}${p.deleted_at ? " (deleted)" : ""}` : "Patient record";
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Server-filtered invoice register. Financial records are voided, never destructively deleted. */
export function BillingPage({ token, role }: { token: string; role: UserRole }) {
  const [rows, setRows] = useState<Paginated<InvoiceRow> | null>(null);
  const [selected, setSelected] = useState<InvoiceRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRow | null>(null);
  const debouncedSearch = useDebounced(search);
  const isAdmin = role === "admin";
  const request = useRef(0);

  useEffect(() => { setPage(1); }, [debouncedSearch, status, dateFrom, dateTo, perPage]);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError("");
    try {
      const res = await invoiceApi.list(token, { page, per_page: perPage, search: debouncedSearch || undefined, status: status || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined, sort: "invoice_date", direction: "desc" });
      if (id !== request.current) return;
      setRows((res as unknown as { data: Paginated<InvoiceRow> }).data);
    } catch (e: unknown) { if (id === request.current) setError(e instanceof Error ? e.message : "Could not load invoices."); }
    finally { if (id === request.current) setLoading(false); }
  }, [token, page, perPage, debouncedSearch, status, dateFrom, dateTo]);
  useEffect(() => { void load(); return () => { ++request.current; }; }, [load]);

  const openInvoice = async (id: number) => {
    try {
      const res = await invoiceApi.get(token, id);
      setSelected((res as unknown as { data: InvoiceRow }).data);
      setError("");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not open invoice."); }
  };
  const refreshSelected = async () => {
    await Promise.all([load(), (async () => {
      if (!selected) return;
      try {
        const { data } = await invoiceApi.get(token, selected.id);
        setSelected((current) => current?.id === data.id ? data : current);
      } catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not refresh invoice."); }
    })()]);
  };
  useLiveRefresh(refreshSelected);
  const doVoid = async () => {
    if (!selected) return;
    try { await invoiceApi.void(token, selected.id); setNotice("Invoice voided"); await refreshSelected(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not void invoice."); }
  };
  const printReceipt = async (id: number) => {
    const printWindow = window.open("about:blank", "_blank");
    if (!printWindow) { setError("Allow pop-ups to print the receipt."); return; }
    try {
      const res = await invoiceApi.receipt(token, id);
      const data = (res as unknown as { data: { invoice: InvoiceRow; clinic: { clinic_name?: string; address?: string; phone?: string; logo_data_uri?: string | null } | null } }).data;
      const invoice = data.invoice;
      const logo = (data.clinic?.logo_data_uri ?? "").startsWith("data:image/") ? data.clinic!.logo_data_uri! : "";
      const items = (invoice.items ?? []).map((item) => `<tr><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.quantity)}</td><td>${money(item.unit_price)}</td><td>${money(item.line_total)}</td></tr>`).join("");
      const header = `<div class="head">${logo ? `<img class="logo" src="${logo}" alt="">` : ""}<div><h1>${escapeHtml(data.clinic?.clinic_name || "Clinic")}</h1><div>${escapeHtml(data.clinic?.address || "")}</div><div>${escapeHtml(data.clinic?.phone || "")}</div></div></div>`;
      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(invoice.invoice_number)}</title><style>body{font:14px Arial,sans-serif;color:#19302f;max-width:760px;margin:40px auto;padding:0 24px}h1{font:28px Georgia,serif}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:10px;border-bottom:1px solid #dfeae5;text-align:left}td:nth-child(n+2),th:nth-child(n+2){text-align:right}.total{text-align:right;font-size:20px;font-weight:bold}.head{display:flex;gap:18px;align-items:center;margin-bottom:6px}.head div{margin:2px 0}.logo{width:72px;height:72px;object-fit:contain}@media print{body{margin:0 auto}}</style></head><body>${header}<hr><h2>Receipt ${escapeHtml(invoice.invoice_number)}</h2><p>Patient: ${escapeHtml(patientName(invoice.patient))}</p><p>Date: ${escapeHtml(invoice.invoice_date)}</p><table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${items}</tbody></table><p class="total">Invoice total: ${money(invoice.total_amount)}</p></body></html>`);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } catch (e: unknown) {
      printWindow.close();
      setError(e instanceof Error ? e.message : "Could not load receipt.");
    }
  };

  const records = rows?.data ?? [];
  return (
    <Card><CardContent>
      <Stack spacing={1.5} sx={{ mb: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} alignItems={{ sm: "center" }} justifyContent="space-between">
          <Box><Typography component="h2" variant="h5">Invoices</Typography><Typography variant="body2" color="text.secondary">{rows ? `${rows.total} matching invoices` : "Loading invoices"}. Totals are calculated by the server.</Typography></Box>
          <Button variant="contained" startIcon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>Create invoice</Button>
        </Stack>
        <Box className="filter-toolbar">
          <SearchField value={search} onChange={setSearch} placeholder="Search invoice or patient" />
          <FilterSelect label="Status" value={status} onChange={setStatus} width={155} options={[{ value: "unpaid", label: "Unpaid" }, { value: "partially_paid", label: "Partially paid" }, { value: "paid", label: "Paid" }, { value: "void", label: "Void" }]} />
          <TextField type="date" label="From" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField type="date" label="To" value={dateTo} onChange={(e) => setDateTo(e.target.value)} InputLabelProps={{ shrink: true }} />
        </Box>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}{notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}
      {loading && !rows && <Box sx={{ display: "grid", placeItems: "center", py: 6 }}><CircularProgress /></Box>}
      <Box className="desktop-data-table table-scroll" role="region" aria-label="Invoices" tabIndex={0}>
        <Table size="small"><TableHead><TableRow><TableCell>Invoice</TableCell><TableCell>Patient</TableCell><TableCell>Date</TableCell><TableCell align="right">Total</TableCell><TableCell>Status</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
          <TableBody>{records.map((row) => <TableRow key={row.id} hover><TableCell className="mono">{row.invoice_number}</TableCell><TableCell>{patientCell(row.patient)}</TableCell><TableCell>{String(row.invoice_date).slice(0, 10)}</TableCell><TableCell align="right" sx={{ fontWeight: 700 }}>{money(row.total_amount)}</TableCell><TableCell><Chip size="small" label={row.status.replace(/_/g, " ")} color={row.status === "paid" ? "success" : row.status === "void" ? "default" : "warning"} /></TableCell><TableCell align="right"><Button size="small" onClick={() => void openInvoice(row.id)}>Open</Button></TableCell></TableRow>)}
            {!loading && records.length === 0 && <TableRow><TableCell colSpan={6}><Typography sx={{ py: 2 }} color="text.secondary">No invoices match these filters.</Typography></TableCell></TableRow>}</TableBody>
        </Table>
      </Box>
      <Box className="mobile-record-list" aria-label="Invoice records">{!loading && records.length === 0 && <Box className="mobile-record-card"><Typography color="text.secondary">No invoices match these filters.</Typography></Box>}{records.map((row) => <Box className="mobile-record-card" key={row.id}><Box className="mobile-record-main"><Box><Typography className="mono" fontWeight={700}>{row.invoice_number}</Typography><Typography fontWeight={700}>{patientName(row.patient)}</Typography></Box><Chip size="small" label={row.status.replace(/_/g, " ")} color={row.status === "paid" ? "success" : row.status === "void" ? "default" : "warning"} /></Box><Box className="mobile-record-meta"><span>Date</span><Typography variant="body2">{String(row.invoice_date).slice(0, 10)}</Typography><span>Total</span><Typography variant="body2" fontWeight={700}>{money(row.total_amount)}</Typography></Box><Button className="mobile-record-action" onClick={() => void openInvoice(row.id)}>Open invoice</Button></Box>)}</Box>
      {rows && rows.total > 0 && <PagerBar page={rows.current_page} lastPage={rows.last_page} total={rows.total} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />}
      {selected && <InvoiceDetail token={token} role={role} invoice={selected} onClose={() => setSelected(null)} onRefresh={refreshSelected} onVoid={() => void doVoid()} onPrint={() => void printReceipt(selected.id)} onEdit={() => setEditingInvoice(selected)} />}
      {createOpen && <InvoiceCreate token={token} onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); setNotice("Invoice created"); await load(); }} />}
      {editingInvoice && <InvoiceCreate token={token} editing={editingInvoice} onClose={() => setEditingInvoice(null)} onCreated={async () => { setEditingInvoice(null); setNotice("Invoice updated"); await refreshSelected(); await load(); }} />}
    </CardContent></Card>
  );
}

function InvoiceDetail({ token, role, invoice, onClose, onRefresh, onVoid, onPrint, onEdit }: { token: string; role: UserRole; invoice: InvoiceRow; onClose: () => void; onRefresh: () => Promise<void>; onVoid: () => void; onPrint: () => void; onEdit: () => void }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentRow["payment_method"]>("cash");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentMenu, setPaymentMenu] = useState<{ anchor: HTMLElement; payment: PaymentRow } | null>(null);
  const paid = Number(invoice.paid_amount ?? (invoice.payments ?? []).filter((p) => p.status === "completed").reduce((sum, p) => sum + Number(p.amount), 0));
  const balance = Number(invoice.balance ?? Math.max(0, Number(invoice.total_amount) - paid));
  const canPay = role === "admin" || role === "receptionist";
  const canAdjust = role === "admin";
  const recordPayment = async () => {
    setBusy(true); setError("");
    try { await invoiceApi.pay(token, invoice.id, { amount: Number(amount), payment_method: method }); setAmount(""); await onRefresh(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Payment could not be recorded."); }
    finally { setBusy(false); }
  };
  const adjustPayment = async (payment: PaymentRow, action: "reverse" | "refund") => {
    setBusy(true); setError("");
    try { if (action === "reverse") await paymentApi.reverse(token, payment.id); else await paymentApi.refund(token, payment.id); await onRefresh(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : `Payment could not be ${action}ed.`); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md"><DialogTitle>Invoice {invoice.invoice_number}</DialogTitle><DialogContent>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Stack direction="row" spacing={1} flexWrap="wrap"><Chip label={patientCell(invoice.patient)} /><Chip label={`Date ${String(invoice.invoice_date).slice(0, 10)}`} /><Chip color={invoice.status === "paid" ? "success" : invoice.status === "void" ? "default" : "warning"} label={invoice.status.replace(/_/g, " ")} /></Stack>
      <Box className="table-scroll" sx={{ mt: 2 }}><Table size="small"><TableHead><TableRow><TableCell>Description</TableCell><TableCell align="right">Qty</TableCell><TableCell align="right">Unit price</TableCell><TableCell align="right">Line total</TableCell></TableRow></TableHead><TableBody>{(invoice.items ?? []).map((item) => <TableRow key={item.id}><TableCell>{item.description}</TableCell><TableCell align="right">{item.quantity}</TableCell><TableCell align="right">{money(item.unit_price)}</TableCell><TableCell align="right">{money(item.line_total)}</TableCell></TableRow>)}</TableBody></Table></Box>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="flex-end" spacing={1} sx={{ mt: 2 }}><Chip label={`Subtotal ${money(invoice.subtotal)}`} /><Chip label={`Discount ${money(invoice.discount_amount)}`} /><Chip color="primary" label={`Total ${money(invoice.total_amount)}`} /><Chip label={`Balance ${money(balance)}`} /></Stack>
      <Typography component="h3" variant="h6" sx={{ mt: 3, mb: 1 }}>Payments</Typography>
      {(invoice.payments ?? []).length === 0 && <Typography color="text.secondary">No payments recorded.</Typography>}
      {(invoice.payments ?? []).map((payment) => <Stack key={payment.id} direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ sm: "center" }} sx={{ py: 1, borderBottom: "1px solid #e5ece8" }}><Typography variant="body2">Payment {payment.payment_number}, {payment.payment_method.replace(/_/g, " ")}, {money(payment.amount)}, {payment.status}</Typography>{canAdjust && payment.status === "completed" && <Button size="small" disabled={busy} aria-label={`Actions for payment ${payment.payment_number}`} onClick={(e) => setPaymentMenu({ anchor: e.currentTarget, payment })}>Actions</Button>}</Stack>)}
      <Menu anchorEl={paymentMenu?.anchor} open={!!paymentMenu} onClose={() => setPaymentMenu(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        <MenuItem onClick={() => { if (paymentMenu) void adjustPayment(paymentMenu.payment, "reverse"); setPaymentMenu(null); }}>Reverse payment</MenuItem>
        <MenuItem onClick={() => { if (paymentMenu) void adjustPayment(paymentMenu.payment, "refund"); setPaymentMenu(null); }}>Refund payment</MenuItem>
      </Menu>
      {canPay && invoice.status !== "void" && balance > 0 && <Box sx={{ mt: 2, p: 2, border: "1px solid #e5ece8", borderRadius: 2 }}><Typography variant="subtitle2" sx={{ mb: 1 }}>Record payment</Typography><Stack direction={{ xs: "column", sm: "row" }} spacing={1}><TextField label="Amount" type="number" inputProps={{ min: .01, max: balance, step: .01 }} value={amount} onChange={(e) => setAmount(e.target.value)} /><TextField select label="Method" value={method} onChange={(e) => setMethod(e.target.value as PaymentRow["payment_method"])} sx={{ minWidth: 155 }}><MenuItem value="cash">Cash</MenuItem><MenuItem value="upi">UPI</MenuItem><MenuItem value="card">Card</MenuItem><MenuItem value="bank_transfer">Bank transfer</MenuItem><MenuItem value="other">Other</MenuItem></TextField><Button variant="contained" disabled={busy || !amount || Number(amount) <= 0 || Number(amount) > balance} onClick={() => void recordPayment()}>{busy ? <CircularProgress size={18} /> : "Record payment"}</Button></Stack></Box>}
      <Stack direction="row" flexWrap="wrap" spacing={1} sx={{ mt: 2 }}><Button startIcon={<IconPrinter size={16} />} onClick={onPrint}>Print receipt</Button><WhatsAppButton
        variant="button"
        phone={invoice.patient?.phone}
        message={invoiceMessage(invoice.patient, getClinicDetails().name, invoice)}
        patientName={patientName(invoice.patient)}
        label="WhatsApp"
        reason={invoice.patient?.deleted_at
          ? "This patient record was deleted."
          : !invoice.patient
            ? "The patient record for this invoice is missing."
            : "This patient has no phone number on file."}
      />{canAdjust && invoice.status !== "void" && (invoice.payments ?? []).every((p) => p.status !== "completed") && <Button onClick={onEdit}>Edit invoice</Button>}{canAdjust && invoice.status !== "void" && (invoice.payments ?? []).every((p) => p.status !== "completed") && <Button color="error" onClick={onVoid}>Void invoice</Button>}</Stack>
      {(invoice.patient?.deleted_at || !invoice.patient?.phone) && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          {invoice.patient?.deleted_at
            ? "This patient record was deleted. The message still goes to the number on file."
            : !invoice.patient
              ? "WhatsApp is unavailable: the patient record for this invoice is missing."
              : "WhatsApp is unavailable: this patient has no phone number on file."}
        </Typography>
      )}
    </DialogContent><DialogActions><Button onClick={onClose}>Close</Button></DialogActions></Dialog>
  );
}

export async function printReceiptDoc(token: string, id: number, onError: (msg: string) => void) {
  const printWindow = window.open("about:blank", "_blank");
  if (!printWindow) { onError("Allow pop-ups to print the receipt."); return; }
  try {
    const res = await invoiceApi.receipt(token, id);
    const data = (res as unknown as { data: { invoice: InvoiceRow; clinic: { clinic_name?: string; address?: string; phone?: string; logo_data_uri?: string | null } | null } }).data;
    const invoice = data.invoice;
    const logo = (data.clinic?.logo_data_uri ?? "").startsWith("data:image/") ? data.clinic!.logo_data_uri! : "";
    const items = (invoice.items ?? []).map((item) => `<tr><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.quantity)}</td><td>${money(item.unit_price)}</td><td>${money(item.line_total)}</td></tr>`).join("");
    const header = `<div class="head">${logo ? `<img class="logo" src="${logo}" alt="">` : ""}<div><h1>${escapeHtml(data.clinic?.clinic_name || "Clinic")}</h1><div>${escapeHtml(data.clinic?.address || "")}</div><div>${escapeHtml(data.clinic?.phone || "")}</div></div></div>`;
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(invoice.invoice_number)}</title><style>body{font:14px Arial,sans-serif;color:#19302f;max-width:760px;margin:40px auto;padding:0 24px}h1{font:28px Georgia,serif}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:10px;border-bottom:1px solid #dfeae5;text-align:left}td:nth-child(n+2),th:nth-child(n+2){text-align:right}.total{text-align:right;font-size:20px;font-weight:bold}.head{display:flex;gap:18px;align-items:center;margin-bottom:6px}.head div{margin:2px 0}.logo{width:72px;height:72px;object-fit:contain}@media print{body{margin:0 auto}}</style></head><body>${header}<hr><h2>Receipt ${escapeHtml(invoice.invoice_number)}</h2><p>Patient: ${escapeHtml(patientName(invoice.patient))}</p><p>Date: ${escapeHtml(invoice.invoice_date)}</p><table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${items}</tbody></table><p class="total">Invoice total: ${money(invoice.total_amount)}</p></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  } catch (e: unknown) {
    printWindow.close();
    onError(e instanceof Error ? e.message : "Could not load receipt.");
  }
}

export function InvoiceCreate({ token, editing, presetVisit, onClose, onCreated }: { token: string; editing?: InvoiceRow | null; presetVisit?: VisitRow | null; onClose: () => void; onCreated: () => Promise<void> }) {
  const [patient, setPatient] = useState<PatientRow | null>(editing?.patient ?? presetVisit?.patient ?? null);
  const [patientSearch, setPatientSearch] = useState(presetVisit?.patient ? patientName(presetVisit.patient) : "");
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [visitId, setVisitId] = useState<number | "">(editing?.visit_id ?? presetVisit?.id ?? "");
  const [patientVisits, setPatientVisits] = useState<VisitRow[]>(presetVisit ? [presetVisit] : []);
  const [selectedVisit, setSelectedVisit] = useState<VisitRow | null>(presetVisit ?? null);
  const defaultLines = () => {
    if (editing?.items?.length) {
      return editing.items.map((item) => ({ description: item.description, quantity: String(item.quantity), unit_price: String(item.unit_price) }));
    }
    if (presetVisit) {
      const docName = presetVisit.doctor?.display_name ? ` - Dr. ${presetVisit.doctor.display_name}` : "";
      const fee = presetVisit.doctor?.consultation_fee ? String(presetVisit.doctor.consultation_fee) : "";
      return [{ description: `Consultation${docName} (${presetVisit.visit_number})`, quantity: "1", unit_price: fee }];
    }
    return [{ description: "", quantity: "1", unit_price: "" }];
  };
  const [lines, setLines] = useState<{ description: string; quantity: string; unit_price: string }[]>(defaultLines);
  const [discount, setDiscount] = useState(editing ? String(editing.discount_amount ?? "") : "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const debouncedSearch = useDebounced(patientSearch, 250);
  const patientRequest = useRef(0);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const loadPatients = useCallback(async () => {
    if (editing || presetVisit) return;
    const id = ++patientRequest.current;
    return patientApi.list(token, { search: debouncedSearch || undefined, per_page: 50, sort: "first_name", direction: "asc" })
      .then((res) => { if (id === patientRequest.current) setPatients((res as unknown as { data: Paginated<PatientRow> }).data.data); })
      .catch((e: unknown) => { if (id === patientRequest.current) setError(e instanceof Error ? e.message : "Could not search patients."); });
  }, [token, debouncedSearch, editing, presetVisit]);
  useEffect(() => { void loadPatients(); return () => { ++patientRequest.current; }; }, [loadPatients]);

  useEffect(() => {
    if (editing || presetVisit || !patient?.id) {
      if (!presetVisit && !editing) {
        setPatientVisits([]);
        setVisitId("");
        setSelectedVisit(null);
      }
      return;
    }
    visitApi.list(token, { patient_id: patient.id, per_page: 20, sort: "visit_date", direction: "desc" })
      .then((res) => {
        const vList = (res as unknown as { data: Paginated<VisitRow> }).data.data;
        setPatientVisits(vList);
      })
      .catch(() => {});
  }, [token, patient?.id, editing, presetVisit]);

  const onSelectVisit = (v: VisitRow | null) => {
    setSelectedVisit(v);
    setVisitId(v ? v.id : "");
    if (v && lines.length === 1 && !lines[0].description) {
      const docName = v.doctor?.display_name ? ` - Dr. ${v.doctor.display_name}` : "";
      const fee = v.doctor?.consultation_fee ? String(v.doctor.consultation_fee) : "";
      setLines([{ description: `Consultation${docName} (${v.visit_number})`, quantity: "1", unit_price: fee }]);
    }
  };

  useLiveRefresh(async () => {
    await loadPatients();
    if (!editing) {
      if (patient) {
        try {
          const { data } = await patientApi.get(token, patient.id);
          setPatient((current) => current?.id === data.id ? data : current);
        } catch { setError("Could not refresh the selected patient. Your invoice draft is unchanged."); }
      }
      return;
    }
    try {
      const { data } = await invoiceApi.get(token, editing.id);
      setRemoteChanged(data.status !== editing.status || JSON.stringify(data.items) !== JSON.stringify(editing.items) || data.discount_amount !== editing.discount_amount || data.notes !== editing.notes || (data.payments ?? []).some((payment) => payment.status === "completed"));
    } catch { setError("Could not check the latest invoice. Your draft is unchanged."); }
  });
  const save = async () => {
    setError("");
    const items = lines.filter((line) => line.description.trim() && Number(line.quantity) > 0 && Number(line.unit_price) >= 0).map((line) => ({ description: line.description.trim(), quantity: Number(line.quantity), unit_price: Number(line.unit_price) }));
    if (!patient) { setError("Select a patient before creating an invoice."); return; }
    if (!items.length) { setError("Add at least one line with a description and quantity."); return; }
    setBusy(true);
    try {
      if (editing) {
        await invoiceApi.update(token, editing.id, { items, discount_amount: discount ? Number(discount) : 0, notes: notes.trim() || undefined });
      } else {
        await invoiceApi.create(token, { patient_id: patient.id, visit_id: visitId || undefined, items, discount_amount: discount ? Number(discount) : 0, notes: notes.trim() || undefined });
      }
      await onCreated();
    }
    catch (e: unknown) { setError(e instanceof Error ? e.message : editing ? "Invoice could not be updated." : "Invoice could not be created."); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm"><DialogTitle>{editing ? `Edit invoice ${editing.invoice_number}` : "Create invoice"}</DialogTitle><DialogContent>
      {remoteChanged && <Alert severity="warning" sx={{ mb: 2 }}>This invoice changed elsewhere. Your draft is unchanged. Reopen the form to review the latest invoice before saving.</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {presetVisit ? (
        <Box sx={{ p: 1.5, bgcolor: "#f2f7f5", borderRadius: 2, border: "1px solid #d3e4dc", mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", textTransform: "uppercase", fontWeight: 700 }}>
            Linked consultation visit
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {presetVisit.visit_number} • {patientName(patient)} • {presetVisit.visit_date}
          </Typography>
        </Box>
      ) : editing ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Patient: {patientName(editing.patient)}</Typography>
      ) : (
        <>
          <Autocomplete options={patients} value={patient} getOptionLabel={patientName} isOptionEqualToValue={(a, b) => a.id === b.id} onChange={(_, value) => { setPatient(value); setPatientSearch(value ? patientName(value) : ""); }} inputValue={patientSearch} onInputChange={(_, value, reason) => { if (reason !== "reset") setPatientSearch(value); }} renderInput={(params) => <TextField {...params} label="Patient" placeholder="Search name, ID or phone" required />} />
          {patient && patientVisits.length > 0 && (
            <Autocomplete
              options={patientVisits}
              value={selectedVisit}
              getOptionLabel={(v) => `${v.visit_number} (${v.visit_date}) - ${v.doctor?.display_name || "Doctor"}`}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              onChange={(_, v) => onSelectVisit(v)}
              sx={{ mt: 2 }}
              renderInput={(params) => <TextField {...params} label="Link consultation visit (optional)" placeholder="Select visit to auto-fill consultation fee" />}
            />
          )}
        </>
      )}
      <Typography variant="subtitle2" sx={{ mt: 2 }}>Invoice lines</Typography>
      {lines.map((line, i) => <Box key={i} className="invoice-line-form"><TextField label="Service or item" value={line.description} onChange={(e) => setLines((all) => all.map((x, ix) => ix === i ? { ...x, description: e.target.value } : x))} /><TextField label="Qty" type="number" inputProps={{ min: .01, step: .01 }} value={line.quantity} onChange={(e) => setLines((all) => all.map((x, ix) => ix === i ? { ...x, quantity: e.target.value } : x))} /><TextField label="Unit price ₹" type="number" inputProps={{ min: 0, step: .01 }} value={line.unit_price} onChange={(e) => setLines((all) => all.map((x, ix) => ix === i ? { ...x, unit_price: e.target.value } : x))} /><Button color="error" disabled={lines.length === 1} onClick={() => setLines((all) => all.filter((_, ix) => ix !== i))} aria-label={`Remove invoice line ${i + 1}`}>Remove</Button></Box>)}
      <Button size="small" sx={{ mt: 1 }} onClick={() => setLines((all) => [...all, { description: "", quantity: "1", unit_price: "" }])}>Add line</Button>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 2 }}><TextField label="Discount ₹" type="number" inputProps={{ min: 0, step: .01 }} value={discount} onChange={(e) => setDiscount(e.target.value)} /><TextField fullWidth label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>{editing ? "The server recalculates invoice totals. An invoice with recorded payments cannot be edited." : "The server validates and calculates invoice totals. Issued invoices are voided, not deleted."}</Typography>
    </DialogContent><DialogActions><Button onClick={onClose} disabled={busy}>Close</Button><Button variant="contained" disabled={busy || !patient || !lines.some((line) => line.description.trim() && line.unit_price !== "")} onClick={() => void save()}>{busy ? <CircularProgress size={18} /> : editing ? "Save changes" : "Create invoice"}</Button></DialogActions></Dialog>
  );
}
