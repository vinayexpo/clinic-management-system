import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem,
  Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import { IconPlus, IconPrinter, IconSparkles } from "@tabler/icons-react";
import { prescriptionApi, visitApi, aiApi, type AiPrescriptionItem, type AiStatus, type Paginated, type PrescriptionItemRow, type PrescriptionRow, type VisitRow } from "../api";
import { FilterSelect, PagerBar, SearchField, useDebounced } from "../components/common";
import { WhatsAppButton } from "../components/WhatsAppButton";
import { getClinicDetails } from "../lib/clinicStore";
import { prescriptionMessage } from "../lib/whatsapp";
import { useLiveRefresh } from "../lib/realtime";

type DraftMedicine = { medicine_name: string; strength: string; dosage: string; route: string; frequency: string; duration: string; quantity: string; instructions: string };
const blankMedicine = (): DraftMedicine => ({ medicine_name: "", strength: "", dosage: "", route: "", frequency: "", duration: "", quantity: "", instructions: "" });
const toDraftRows = (rows: AiPrescriptionItem[]): DraftMedicine[] => rows.map((r) => ({
  medicine_name: r.medicine_name,
  strength: r.strength ?? "",
  dosage: r.dosage ?? "",
  route: r.route ?? "",
  frequency: r.frequency ?? "",
  duration: r.duration ?? "",
  quantity: r.quantity ? String(r.quantity) : "",
  instructions: r.instructions ?? "",
}));
const patientName = (v: VisitRow) => v.patient ? [v.patient.first_name, v.patient.last_name].filter(Boolean).join(" ") : `Patient ${v.patient_id}`;
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Browse, filter, edit draft, finalize and print prescriptions using persisted API records. */
export function PrescriptionsPage({ token, ai = null }: { token: string; ai?: AiStatus | null }) {
  const [rows, setRows] = useState<Paginated<PrescriptionRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [editing, setEditing] = useState<PrescriptionRow | null>(null);
  const [actionMenu, setActionMenu] = useState<{ anchor: HTMLElement; prescription: PrescriptionRow } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const debounced = useDebounced(search);
  const request = useRef(0);
  useEffect(() => { setPage(1); }, [debounced, status, from, to, perPage]);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError("");
    try {
      const res = await prescriptionApi.list(token, { page, per_page: perPage, search: debounced || undefined, status: (status || undefined) as PrescriptionRow["status"] | undefined, date_from: from || undefined, date_to: to || undefined, sort: "created_at", direction: "desc" });
      if (id !== request.current) return;
      setRows((res as unknown as { data: Paginated<PrescriptionRow> }).data);
    } catch (e: unknown) { if (id === request.current) setError(e instanceof Error ? e.message : "Could not load prescriptions."); }
    finally { if (id === request.current) setLoading(false); }
  }, [token, page, perPage, debounced, status, from, to]);
  useEffect(() => { void load(); return () => { ++request.current; }; }, [load]);
  useLiveRefresh(async () => {
    await load();
    if (actionMenu) {
      const { data } = await prescriptionApi.get(token, actionMenu.prescription.id);
      setActionMenu((current) => current?.prescription.id === data.id ? { ...current, prescription: data } : current);
    }
  });

  const finalize = async (row: PrescriptionRow) => {
    setError("");
    try { await prescriptionApi.finalize(token, row.id); setNotice(`${row.prescription_number} finalized`); await load(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not finalize prescription."); }
  };
  const remove = async (row: PrescriptionRow) => {
    setError("");
    try { await prescriptionApi.remove(token, row.id); setNotice("Draft prescription deleted"); await load(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not delete prescription."); }
  };
  const print = async (row: PrescriptionRow) => {
    await printPrescriptionDoc(token, row.id, setError);
  };

  const records = rows?.data ?? [];
  return (
    <Card><CardContent>
      <Stack spacing={1.5} sx={{ mb: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ sm: "center" }}><Box><Typography component="h2" variant="h5">Prescription register</Typography><Typography variant="body2" color="text.secondary">{rows ? `${rows.total} matching prescriptions` : "Loading prescriptions"}. Drafts can be edited; finalized records are read-only.</Typography></Box><Button variant="contained" startIcon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>New prescription</Button></Stack>
        <Box className="filter-toolbar"><SearchField value={search} onChange={setSearch} placeholder="Search prescription, patient or medicine" /><FilterSelect label="Status" value={status} onChange={setStatus} width={155} options={[{ value: "draft", label: "Draft" }, { value: "finalized", label: "Finalized" }, { value: "cancelled", label: "Cancelled" }]} /><TextField type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} /><TextField type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} /></Box>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}{notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}
      {loading && !rows && <Box sx={{ display: "grid", placeItems: "center", py: 6 }}><CircularProgress /></Box>}
        <Box className="desktop-data-table table-scroll" role="region" aria-label="Prescription register" tabIndex={0}><Table size="small"><TableHead><TableRow><TableCell>Prescription</TableCell><TableCell>Patient</TableCell><TableCell>Doctor</TableCell><TableCell>Date</TableCell><TableCell>Medicines</TableCell><TableCell>Status</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead><TableBody>
        {records.map((rx) => <TableRow key={rx.id} hover><TableCell className="mono">{rx.prescription_number}</TableCell><TableCell>{rx.patient ? [rx.patient.first_name, rx.patient.last_name].filter(Boolean).join(" ") : `Patient ${rx.patient_id}`}</TableCell><TableCell>{rx.doctor?.display_name ?? "—"}</TableCell><TableCell>{String(rx.issued_at ?? rx.visit?.visit_date ?? "").slice(0, 10) || "Draft"}</TableCell><TableCell>{(rx.items ?? []).length}</TableCell><TableCell><Chip size="small" label={rx.status} color={rx.status === "finalized" ? "success" : rx.status === "draft" ? "warning" : "default"} /></TableCell>                <TableCell align="right"><Stack direction="row" justifyContent="flex-end" flexWrap="wrap" spacing={.5} alignItems="center">{rx.status === "draft" && <><Button size="small" color="success" onClick={() => void finalize(rx)}>Finalize</Button><Button size="small" aria-label={`Actions for ${rx.prescription_number}`} onClick={(e) => setActionMenu({ anchor: e.currentTarget, prescription: rx })}>Actions</Button></>}{rx.status === "finalized" && <WhatsAppButton
                  variant="icon"
                  phone={rx.patient?.phone}
                  message={prescriptionMessage(rx.patient, getClinicDetails().name, rx, `${window.location.origin}/portal`)}
                  patientName={rx.patient ? [rx.patient.first_name, rx.patient.last_name].filter(Boolean).join(" ") : undefined}
                  tooltip={`Tell ${rx.patient?.first_name ?? "the patient"} the prescription is ready on WhatsApp`}
                />}{rx.status === "finalized" && <Button size="small" startIcon={<IconPrinter size={14} />} onClick={() => void print(rx)}>Print</Button>}</Stack></TableCell></TableRow>)}
        {!loading && records.length === 0 && <TableRow><TableCell colSpan={7}><Typography color="text.secondary" sx={{ py: 2 }}>No prescriptions match these filters.</Typography></TableCell></TableRow>}
      </TableBody></Table></Box>
      <Box className="mobile-record-list" aria-label="Prescription records">{!loading && records.length === 0 && <Box className="mobile-record-card"><Typography color="text.secondary">No prescriptions match these filters.</Typography></Box>}{records.map((rx) => <Box className="mobile-record-card" key={rx.id}><Box className="mobile-record-main"><Box><Typography className="mono">{rx.prescription_number}</Typography><Typography fontWeight={700}>{rx.patient ? [rx.patient.first_name, rx.patient.last_name].filter(Boolean).join(" ") : `Patient ${rx.patient_id}`}</Typography></Box><Chip size="small" label={rx.status} color={rx.status === "finalized" ? "success" : rx.status === "draft" ? "warning" : "default"} /></Box><Box className="mobile-record-meta"><span>Doctor</span><Typography variant="body2">{rx.doctor?.display_name ?? "—"}</Typography><span>Medicines</span><Typography variant="body2">{(rx.items ?? []).length}</Typography><span>Date</span><Typography variant="body2">{String(rx.issued_at ?? rx.visit?.visit_date ?? "").slice(0, 10) || "Draft"}</Typography></Box><Stack direction="row" flexWrap="wrap" spacing={1}>{rx.status === "draft" && <><Button className="mobile-record-action" color="success" onClick={() => void finalize(rx)}>Finalize</Button><Button className="mobile-record-action" aria-label={`Actions for ${rx.prescription_number}`} onClick={(e) => setActionMenu({ anchor: e.currentTarget, prescription: rx })}>Actions</Button></>}{rx.status === "finalized" && <Button className="mobile-record-action" onClick={() => void print(rx)}>Print</Button>}</Stack></Box>)}</Box>
      {rows && rows.total > 0 && <PagerBar page={rows.current_page} lastPage={rows.last_page} total={rows.total} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />}
      <Menu anchorEl={actionMenu?.anchor} open={!!actionMenu} onClose={() => setActionMenu(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        <MenuItem onClick={() => { if (actionMenu) setEditing(actionMenu.prescription); setActionMenu(null); }}>Edit draft</MenuItem>
        <MenuItem onClick={() => { if (actionMenu) void remove(actionMenu.prescription); setActionMenu(null); }}>Delete draft</MenuItem>
      </Menu>
      {(createOpen || editing) && <PrescriptionForm token={token} ai={ai} initial={editing} onClose={() => { setCreateOpen(false); setEditing(null); }} onSaved={async () => { setCreateOpen(false); setEditing(null); setNotice(editing ? "Draft prescription updated" : "Draft prescription created"); await load(); }} />}
    </CardContent></Card>
  );
}

export async function printPrescriptionDoc(token: string, rowId: number, onError: (msg: string) => void) {
  const printWindow = window.open("about:blank", "_blank");
  if (!printWindow) { onError("Allow pop-ups to print prescriptions."); return; }
  try {
    const response = await prescriptionApi.print(token, rowId);
    const data = (response as unknown as { data: { prescription: PrescriptionRow; clinic: { clinic_name?: string; address?: string; phone?: string; prescription_footer?: string; logo_data_uri?: string | null } | null } }).data;
    const rx = data.prescription;
    const logo = (data.clinic?.logo_data_uri ?? "").startsWith("data:image/") ? data.clinic!.logo_data_uri! : "";
    const medicineRows = (rx.items ?? []).map((m) => `<tr><td>${escape(m.medicine_name)} ${escape(m.strength)}</td><td>${escape(m.dosage)}</td><td>${escape(m.route)}</td><td>${escape(m.frequency)}</td><td>${escape(m.duration)}</td></tr>`).join("");
    const header = `<div class="head">${logo ? `<img class="logo" src="${logo}" alt="">` : ""}<div><h1>${escape(data.clinic?.clinic_name || "Clinic")}</h1><p>${escape(data.clinic?.address || "")}</p><p>${escape(data.clinic?.phone || "")}</p></div></div>`;
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(rx.prescription_number)}</title><style>body{font:14px Arial,sans-serif;color:#19302f;max-width:780px;margin:36px auto;padding:0 24px}h1{font:28px Georgia,serif}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:10px;border-bottom:1px solid #dfeae5;text-align:left;vertical-align:top}footer{margin-top:42px;color:#637372}.head{display:flex;gap:18px;align-items:center;margin-bottom:6px}.head p{margin:2px 0}.logo{width:72px;height:72px;object-fit:contain}</style></head><body>${header}<hr><h2>Prescription ${escape(rx.prescription_number)}</h2><p>Patient: ${escape(patientName(rx.visit ?? ({ patient: rx.patient, patient_id: rx.patient_id } as VisitRow)))}</p><p>Doctor: ${escape(rx.doctor?.display_name || "—")}</p><p>Date: ${escape(rx.issued_at?.slice(0, 10))}</p><table><thead><tr><th>Medicine</th><th>Dosage</th><th>Route</th><th>Frequency</th><th>Duration</th></tr></thead><tbody>${medicineRows}</tbody></table><p>${escape(rx.instructions)}</p><footer>${escape(data.clinic?.prescription_footer || "")}</footer></body></html>`);
    printWindow.document.close(); printWindow.focus(); printWindow.print();
  } catch (e: unknown) { printWindow.close(); onError(e instanceof Error ? e.message : "Could not prepare prescription printout."); }
}

export function PrescriptionForm({ token, ai = null, initial, presetVisit = null, onClose, onSaved }: { token: string; ai?: AiStatus | null; initial: PrescriptionRow | null; presetVisit?: VisitRow | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [visitSearch, setVisitSearch] = useState(presetVisit ? `${presetVisit.visit_number}, ${patientName(presetVisit)}, ${presetVisit.visit_date}` : "");
  const [visitId, setVisitId] = useState<number | "">(initial?.visit_id ?? presetVisit?.id ?? "");
  const [selectedVisit, setSelectedVisit] = useState<VisitRow | null>(presetVisit ?? null);
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [items, setItems] = useState<DraftMedicine[]>(initial?.items?.map((item) => ({ medicine_name: item.medicine_name, strength: item.strength ?? "", dosage: item.dosage, route: item.route ?? "", frequency: item.frequency, duration: item.duration, quantity: item.quantity ? String(item.quantity) : "", instructions: item.instructions ?? "" })) ?? [blankMedicine()]);
  const [error, setError] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useDebounced(visitSearch, 250);
  const visitRequest = useRef(0);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const loadVisits = useCallback(async () => {
    if (initial || presetVisit) return;
    const id = ++visitRequest.current;
    return visitApi.list(token, { page: 1, per_page: 50, search: query || undefined, sort: "visit_date", direction: "desc" })
      .then((res) => { if (id === visitRequest.current) setVisits((res as unknown as { data: Paginated<VisitRow> }).data.data); })
      .catch((e: unknown) => { if (id === visitRequest.current) setError(e instanceof Error ? e.message : "Could not load visits."); });
  }, [token, query, initial, presetVisit]);
  useEffect(() => { void loadVisits(); return () => { ++visitRequest.current; }; }, [loadVisits]);
  useLiveRefresh(async () => {
    await loadVisits();
    if (!initial) {
      if (selectedVisit) {
        try {
          const { data } = await visitApi.get(token, selectedVisit.id);
          setSelectedVisit((current) => current?.id === data.id ? data : current);
        } catch { setError("Could not refresh the selected visit. Your prescription draft is unchanged."); }
      }
      return;
    }
    try {
      const { data } = await prescriptionApi.get(token, initial.id);
      setRemoteChanged(data.status !== initial.status || data.instructions !== initial.instructions || JSON.stringify(data.items) !== JSON.stringify(initial.items));
    } catch { setError("Could not check the latest prescription. Your draft is unchanged."); }
  });

  const aiFeatureOn = ai?.configured === true && ai.features.prescription === true;
  const aiVisitId = initial?.visit_id ?? (visitId || null);

  /** Ask the clinic's model for medicine rows, then add them under the ones already typed. */
  const suggestWithAi = async () => {
    if (!aiVisitId) return;
    setAiBusy(true);
    setError("");
    try {
      const res = await aiApi.prescriptionDraft(token, aiVisitId, instructions.trim() || undefined);
      const added = toDraftRows(res.data.items);
      setItems((all) => {
        const kept = all.filter((m) => m.medicine_name.trim() || m.dosage.trim() || m.frequency.trim() || m.duration.trim());
        return [...kept, ...added];
      });
      setAiNote(`${added.length} AI row${added.length === 1 ? "" : "s"} below — review doses before saving.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not get AI medicine suggestions.");
    } finally { setAiBusy(false); }
  };

  const save = async () => {
    setError("");
    const validItems = items.filter((m) => m.medicine_name.trim() && m.dosage.trim() && m.frequency.trim() && m.duration.trim()).map((m) => ({
      medicine_name: m.medicine_name.trim(), strength: m.strength.trim() || undefined, dosage: m.dosage.trim(), route: m.route.trim() || undefined,
      frequency: m.frequency.trim(), duration: m.duration.trim(), quantity: m.quantity ? Number(m.quantity) : undefined, instructions: m.instructions.trim() || undefined,
    }));
    if (!initial && !visitId) { setError("Select a consultation visit."); return; }
    if (!validItems.length) { setError("Complete at least one medicine row: name, dosage, frequency, and duration are required."); return; }
    setBusy(true);
    try {
      if (initial) await prescriptionApi.update(token, initial.id, { instructions, items: validItems });
      else await visitApi.createPrescription(token, visitId, { instructions, items: validItems });
      await onSaved();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not save prescription."); }
    finally { setBusy(false); }
  };
  const update = (i: number, key: keyof DraftMedicine, value: string) => setItems((all) => all.map((item, index) => index === i ? { ...item, [key]: value } : item));
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md"><DialogTitle>{initial ? `Edit draft ${initial.prescription_number}` : "Create prescription draft"}</DialogTitle><DialogContent>
      {remoteChanged && <Alert severity="warning" sx={{ mb: 2 }}>This prescription changed elsewhere. Your draft is unchanged. Reopen the form to review the latest prescription before saving.</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!initial && (
        presetVisit ? (
          <Box sx={{ p: 1.5, bgcolor: "#f2f7f5", borderRadius: 2, border: "1px solid #d3e4dc", mb: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", textTransform: "uppercase", fontWeight: 700 }}>
              Linked consultation visit
            </Typography>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {presetVisit.visit_number} • {patientName(presetVisit)} • {presetVisit.visit_date}
            </Typography>
          </Box>
        ) : (
          <Autocomplete options={visits} value={selectedVisit} getOptionLabel={(v) => `${v.visit_number}, ${patientName(v)}, ${v.visit_date}`} isOptionEqualToValue={(a, b) => a.id === b.id} onChange={(_, v) => { setVisitId(v?.id ?? ""); setSelectedVisit(v); setVisitSearch(v ? `${v.visit_number}, ${patientName(v)}, ${v.visit_date}` : ""); }} inputValue={visitSearch} onInputChange={(_, value, reason) => { if (reason !== "reset") setVisitSearch(value); }} renderInput={(params) => <TextField {...params} label="Consultation visit" placeholder="Search patient or visit number" required />} />
        )
      )}
      <TextField fullWidth multiline minRows={2} label="Prescription instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} sx={{ mt: 2 }} />
      {aiFeatureOn && (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ sm: "center" }} sx={{ mt: 1.5, mb: 0.5 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={aiBusy ? <CircularProgress size={14} color="inherit" /> : <IconSparkles size={15} />}
            disabled={aiBusy || !aiVisitId}
            onClick={() => void suggestWithAi()}
          >
            {aiBusy ? "Suggesting…" : "Suggest medicines with AI"}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {aiVisitId ? "Reads this visit's record and allergies." : "Pick the consultation visit first."}
          </Typography>
        </Stack>
      )}
      {aiNote && <Alert severity="info" icon={<IconSparkles size={16} />} sx={{ mb: 1 }}>{aiNote}</Alert>}
      {items.map((m, i) => <Box className="medicine-row-form" key={i}><TextField label="Medicine name *" value={m.medicine_name} onChange={(e) => update(i, "medicine_name", e.target.value)} /><TextField label="Strength" value={m.strength} onChange={(e) => update(i, "strength", e.target.value)} /><TextField label="Dosage *" value={m.dosage} onChange={(e) => update(i, "dosage", e.target.value)} /><TextField label="Route" value={m.route} onChange={(e) => update(i, "route", e.target.value)} /><TextField label="Frequency *" value={m.frequency} onChange={(e) => update(i, "frequency", e.target.value)} /><TextField label="Duration *" value={m.duration} onChange={(e) => update(i, "duration", e.target.value)} /><TextField label="Quantity" type="number" inputProps={{ min: 1 }} value={m.quantity} onChange={(e) => update(i, "quantity", e.target.value)} /><TextField label="Medicine instructions" value={m.instructions} onChange={(e) => update(i, "instructions", e.target.value)} /><Button color="error" disabled={items.length === 1} onClick={() => setItems((all) => all.filter((_, ix) => ix !== i))} aria-label={`Remove medicine row ${i + 1}`}>Remove</Button></Box>)}
      <Button sx={{ mt: 1 }} onClick={() => setItems((all) => [...all, blankMedicine()])}>Add medicine</Button>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Drafts stay editable; finalized ones are read-only.</Typography>
    </DialogContent><DialogActions><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="contained" disabled={busy} onClick={() => void save()}>{busy ? <CircularProgress size={18} /> : "Save draft"}</Button></DialogActions></Dialog>
  );
}
