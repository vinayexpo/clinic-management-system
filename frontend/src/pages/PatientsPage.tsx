import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@mui/material";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  FormControlLabel,
  Switch,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  PASSWORD_MIN,
  patientApi,
  whatsappApi,
  type PatientRow,
  type Paginated,
  type ListParams,
  type DuplicatePatientMatch,
  type WhatsAppSenderState,
} from "../api";
import {
  AvatarPicker,
  FilterSelect,
  PagerBar,
  PersonAvatar,
  SearchField,
  useDebounced,
} from "../components/common";
import { IconBrandWhatsapp, IconHistory } from "@tabler/icons-react";
import { SendMessageDialog } from "../components/SendMessageDialog";
import { WhatsAppButton } from "../components/WhatsAppButton";
import { getClinicDetails } from "../lib/clinicStore";
import { generalMessage } from "../lib/whatsapp";
import { istDateTime, istShortDate } from "../lib/ist";
import { useLiveRefresh } from "../lib/realtime";

const displayName = (p: PatientRow) => [p.first_name, p.last_name].filter(Boolean).join(" ");

/**
 * Patients list with server-side search, sex filter, allergy filter, date filter,
 * sort, pagination, plus create/edit (with photo) and delete (admin, soft delete).
 */
export function PatientsPage({ token, role, onDetail, isAdmin }: {
  token: string; role: string; isAdmin: boolean; onDetail: (p: PatientRow) => void;
}) {
  const [rows, setRows] = useState<Paginated<PatientRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sex, setSex] = useState("");
  const [allergy, setAllergy] = useState("");
  const [portal, setPortal] = useState("");
  const [sort, setSort] = useState<"created_at" | "first_name" | "patient_number">("created_at");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [editing, setEditing] = useState<PatientRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<PatientRow | null>(null);
  const [actionMenu, setActionMenu] = useState<{ anchor: HTMLElement; patient: PatientRow } | null>(null);
  const [busyConsent, setBusyConsent] = useState<number | null>(null);
  const [messageTarget, setMessageTarget] = useState<PatientRow | null>(null);
  const [sender, setSender] = useState<WhatsAppSenderState | null>(null);
  const [toast, setToast] = useState("");

  const debouncedSearch = useDebounced(search);
  const request = useRef(0);

  // Reset to first page whenever a filter changes.
  useEffect(() => { setPage(1); }, [debouncedSearch, sex, allergy, portal, sort, direction, perPage]);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError("");
    try {
      const params: ListParams & { sex?: string; has_allergies?: boolean } = {
        page, per_page: perPage, search: debouncedSearch || undefined, sort, direction,
        sex: sex || undefined, has_allergies: allergy === "yes" ? true : undefined,
        has_login: portal === "" ? undefined : portal === "yes",
      };
      const res = await patientApi.list(token, params);
      if (id !== request.current) return;
      setRows((res as unknown as { data: Paginated<PatientRow> }).data);
    } catch (e: unknown) {
      if (id === request.current) setError(e instanceof Error ? e.message : "Failed to load patients.");
    } finally { if (id === request.current) setLoading(false); }
  }, [token, page, perPage, debouncedSearch, sort, direction, sex, allergy, portal]);

  useEffect(() => { void load(); return () => { ++request.current; }; }, [load]);
  useLiveRefresh(async () => {
    await Promise.all([load(), whatsappApi.sender(token).then((res) => setSender(res.data)).catch(() => setSender(null))]);
    if (actionMenu) {
      const res = await patientApi.get(token, actionMenu.patient.id);
      setActionMenu((current) => current?.patient.id === res.data.id ? { ...current, patient: res.data } : current);
    }
    if (messageTarget) {
      const res = await patientApi.get(token, messageTarget.id);
      setMessageTarget((current) => current?.id === res.data.id ? res.data : current);
    }
  });
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 2400); return () => clearTimeout(t); } }, [toast]);

  // The WhatsApp account decides whether a message goes through the API or opens WhatsApp.
  useEffect(() => {
    let alive = true;
    whatsappApi.sender(token)
      .then((res) => { if (alive) setSender((res as unknown as { data: WhatsAppSenderState }).data); })
      .catch(() => { if (alive) setSender(null); });
    return () => { alive = false; };
  }, [token]);

  const toggleSort = (field: typeof sort) => {
    if (sort === field) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(field); setDirection("asc"); }
  };

  const toggleConsent = async (p: PatientRow) => {
    setBusyConsent(p.id); setError("");
    try {
      await whatsappApi.setConsent(token, p.id, !p.whatsapp_opt_in);
      setToast(p.whatsapp_opt_in ? "WhatsApp reminders turned off" : "WhatsApp reminders turned on");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not update WhatsApp consent.");
    } finally { setBusyConsent(null); }
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      await patientApi.remove(token, toDelete.id);
      setToast("Patient deleted");
      setToDelete(null);
      void load();
    } catch (e: unknown) {
      setToast(e instanceof Error ? e.message : "Delete failed");
      setToDelete(null);
    }
  };

  const items = rows?.data ?? [];
  // The desktop table is hidden below 768px; not mounting it keeps tooltips from
  // measuring an anchor that has no layout box, and the card list serves those widths.
  const isMobile = useMediaQuery("(max-width:767px)");

  return (
    <Card><CardContent sx={{ p: { xs: 1.5, sm: 2.5 } }}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ xs: "stretch", md: "center" }} justifyContent="space-between" sx={{ mb: 2, minWidth: 0, width: "100%" }}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", flex: 1, minWidth: 0, width: "100%" }}>
          <SearchField value={search} onChange={setSearch} placeholder="Search name, ID, phone, email" />
          <FilterSelect label="Sex" value={sex} onChange={setSex} width={135} options={[
            { value: "male", label: "Male" }, { value: "female", label: "Female" }, { value: "other", label: "Other" }, { value: "prefer_not_to_say", label: "Prefer not to say" },
          ]} />
          <FilterSelect label="Allergies" value={allergy} onChange={setAllergy} width={135} options={[{ value: "yes", label: "Has allergies" }]} />
          {isAdmin && <FilterSelect label="Portal login" value={portal} onChange={setPortal} width={135} options={[{ value: "yes", label: "Has login" }, { value: "no", label: "No login" }]} />}
        </Stack>
        {(role === "admin" || role === "receptionist") && <Button variant="contained" onClick={() => setCreating(true)} sx={{ width: { xs: "100%", md: "auto" } }}>Add patient</Button>}
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {toast && <Alert severity="info" sx={{ mb: 2 }}>{toast}</Alert>}
      {loading && !rows && <Box sx={{ display: "grid", placeItems: "center", py: 6 }}><CircularProgress /></Box>}

      {!isMobile && (
      <Box className="desktop-data-table table-scroll" role="region" aria-label="Patients table" tabIndex={0}>
        <Table size="small" className="patients-table" sx={{ minWidth: 960 }}>
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: 112 }} />
          </colgroup>
          <TableHead><TableRow>
            <TableCell sortDirection={sort === "first_name" ? direction : false}><TableSortLabel active={sort === "first_name"} direction={direction} onClick={() => toggleSort("first_name")}>Patient</TableSortLabel></TableCell>
            <TableCell sortDirection={sort === "patient_number" ? direction : false}><TableSortLabel active={sort === "patient_number"} direction={direction} onClick={() => toggleSort("patient_number")}>Patient ID</TableSortLabel></TableCell>
            <TableCell>Contact</TableCell>
            <TableCell>Allergies</TableCell>
            <TableCell>Login & reminders</TableCell>
            <TableCell sortDirection={sort === "created_at" ? direction : false}><TableSortLabel active={sort === "created_at"} direction={direction} onClick={() => toggleSort("created_at")}>Registered</TableSortLabel></TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id} hover>
                <TableCell><Stack direction="row" spacing={1.5} alignItems="center"><PersonAvatar token={token} endpoint={`/patients/${p.id}/avatar`} name={displayName(p)} hasAvatar={p.has_avatar} size={34} cacheKey={p.updated_at} /><Box sx={{ minWidth: 0 }}><Typography fontWeight={700} sx={{ overflowWrap: "break-word" }}>{displayName(p)}</Typography><Typography variant="caption" color="text.secondary">{[p.sex, p.date_of_birth ? `DOB ${String(p.date_of_birth).slice(0, 10)}` : null].filter(Boolean).join(", ") || "—"}</Typography></Box></Stack></TableCell>
                <TableCell className="mono">{p.patient_number}</TableCell>
                <TableCell>
                  <Typography component="span" sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.phone}</Typography>
                  {p.email && (
                    <Tooltip title={p.email}>
                      <Typography variant="caption" display="block" color="text.secondary" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.email}</Typography>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>
                  <Tooltip title={p.allergies_summary || "None known"}>
                    <Chip size="small" variant="outlined" label={p.allergies_summary || "None known"} color={p.allergies_summary ? "warning" : "default"}
                      sx={{ maxWidth: 132, "& .MuiChip-label": { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }} />
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Tooltip title={p.has_login ? `Sign-in phone: ${p.login_phone ?? "set"}` : "No portal login"}>
                    <Chip size="small" variant="outlined" label={p.has_login ? `Login: ${p.login_phone ?? "yes"}` : "Login: none"} color={p.has_login ? "success" : "default"}
                      sx={{ maxWidth: 132, "& .MuiChip-label": { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }} />
                  </Tooltip>
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                    <Tooltip title={p.whatsapp_opt_in ? "Receives WhatsApp reminders" : "Not receiving WhatsApp messages"}>
                      <Chip size="small" variant="outlined" label={p.whatsapp_opt_in ? "WhatsApp on" : "WhatsApp off"} color={p.whatsapp_opt_in ? "success" : "default"}
                        sx={{ maxWidth: 118, "& .MuiChip-label": { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }} />
                    </Tooltip>
                    {(role === "admin" || role === "receptionist") && <Tooltip title={p.whatsapp_opt_in ? "WhatsApp reminders are on. Click to turn them off." : "WhatsApp reminders are off. Click to turn them on."}>
                      <IconButton size="small" aria-label={`${p.whatsapp_opt_in ? "Disable" : "Enable"} WhatsApp reminders for ${displayName(p)}`}
                        onClick={() => void toggleConsent(p)} disabled={!p.phone || busyConsent === p.id}
                        sx={{ color: p.whatsapp_opt_in ? "#0b6b68" : "#a6b2b0" }}>
                        <IconBrandWhatsapp size={17} />
                      </IconButton>
                    </Tooltip>}
                  </Stack>
                </TableCell>
                <TableCell>{p.created_at ? istShortDate(p.created_at) : "—"}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end">
                    <WhatsAppButton
                      variant="icon"
                      phone={p.phone}
                      message={generalMessage(p, getClinicDetails().name)}
                      patientName={displayName(p)}
                    />
                    <Button size="small" aria-label={`Actions for ${displayName(p)}`} onClick={(e) => setActionMenu({ anchor: e.currentTarget, patient: p })} sx={{ minWidth: 0, px: 1 }}>Actions</Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {!loading && items.length === 0 && <TableRow><TableCell colSpan={7}><Typography color="text.secondary" sx={{ py: 2 }}>No patients match these filters.</Typography></TableCell></TableRow>}
          </TableBody>
        </Table>
      </Box>
      )}

      {/* Mobile list */}
      <Box className="mobile-record-list" aria-label="Patients list">
        {!loading && items.length === 0 && (
          <Box className="mobile-record-card" sx={{ textAlign: "center", py: 4 }}>
            <Typography color="text.secondary">No patients match these filters.</Typography>
          </Box>
        )}
        {items.map((p) => (
          <Box className="mobile-record-card" key={p.id}>
            <Box className="mobile-record-main">
              <Box className="mobile-record-person">
                <PersonAvatar token={token} endpoint={`/patients/${p.id}/avatar`} name={displayName(p)} hasAvatar={p.has_avatar} size={42} cacheKey={p.updated_at} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography fontWeight={700} sx={{ overflowWrap: "break-word", wordBreak: "normal", fontSize: "15px", lineHeight: 1.3 }}>
                    {displayName(p)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "break-word", mt: 0.25 }}>
                    {[p.sex ? (p.sex.charAt(0).toUpperCase() + p.sex.slice(1)) : null, p.date_of_birth ? `DOB ${String(p.date_of_birth).slice(0, 10)}` : null].filter(Boolean).join(" • ") || "—"}
                  </Typography>
                </Box>
              </Box>
            </Box>

            <Box className="mobile-record-meta">
              <span>Patient ID</span>
              <Typography className="mono" variant="body2">{p.patient_number}</Typography>

              <span>Contact</span>
              <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ overflowWrap: "break-word" }}>{p.phone || "No phone"}</Typography>
                {p.email && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere", wordBreak: "break-all" }}>
                    {p.email}
                  </Typography>
                )}
              </Box>

              <span>Allergies</span>
              <Box sx={{ minWidth: 0 }}>
                {p.allergies_summary ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    color="warning"
                    label={p.allergies_summary}
                    sx={{
                      height: "auto",
                      maxWidth: "100%",
                      py: 0.25,
                      "& .MuiChip-label": {
                        whiteSpace: "normal",
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        px: 1,
                      },
                    }}
                  />
                ) : (
                  <Typography variant="body2" color="text.secondary">None known</Typography>
                )}
              </Box>

              {isAdmin && (
                <>
                  <span>Login</span>
                  <Chip size="small" variant="outlined" color={p.has_login ? "success" : "default"} label={p.has_login ? `Active: ${p.login_phone ?? "yes"}` : "None"} />
                </>
              )}

              <span>WhatsApp</span>
              <Box sx={{ minWidth: 0, display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                <Chip
                  size="small"
                  variant="outlined"
                  color={p.whatsapp_opt_in ? "success" : "default"}
                  label={!p.phone ? "No phone number" : p.whatsapp_opt_in ? "Reminders on" : "Reminders off"}
                />
                {(role === "admin" || role === "receptionist") && (
                  <Tooltip title={p.whatsapp_opt_in ? "WhatsApp reminders are on. Click to turn them off." : "WhatsApp reminders are off. Click to turn them on."}>
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`${p.whatsapp_opt_in ? "Disable" : "Enable"} WhatsApp reminders for ${displayName(p)}`}
                        onClick={() => void toggleConsent(p)}
                        disabled={!p.phone || busyConsent === p.id}
                        sx={{ color: p.whatsapp_opt_in ? "#0b6b68" : "#a6b2b0" }}
                      >
                        <IconBrandWhatsapp size={17} />
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
              </Box>

              <span>Registered</span>
              <Typography variant="body2" color="text.secondary">{p.created_at ? istDateTime(p.created_at) : "—"}</Typography>
            </Box>

            {role === "doctor" ? (
              <Button
                variant="outlined"
                className="mobile-record-action"
                startIcon={<IconHistory size={16} />}
                aria-label={`View medical history for ${displayName(p)}`}
                onClick={() => onDetail(p)}
              >
                View medical history
              </Button>
            ) : (
              <Stack direction="row" spacing={1} alignItems="center">
                <WhatsAppButton
                  variant="icon"
                  phone={p.phone}
                  message={generalMessage(p, getClinicDetails().name)}
                  patientName={displayName(p)}
                />
                <Button
                  variant="outlined"
                  className="mobile-record-action"
                  aria-label={`Actions for ${displayName(p)}`}
                  onClick={(e) => setActionMenu({ anchor: e.currentTarget, patient: p })}
                >
                  Actions
                </Button>
              </Stack>
            )}
          </Box>
        ))}
      </Box>

      {rows && rows.total > 0 && <PagerBar page={rows.current_page} lastPage={rows.last_page} total={rows.total} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />}

      {(creating || editing) && (
        <PatientForm token={token} initial={editing} isAdmin={isAdmin} onClose={() => { setCreating(false); setEditing(null); }}
          onDetail={onDetail}
          onSaved={(msg) => { setCreating(false); setEditing(null); setToast(msg); void load(); }} />
      )}

      <Menu anchorEl={actionMenu?.anchor} open={!!actionMenu} onClose={() => setActionMenu(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        {role !== "receptionist" && <MenuItem onClick={() => { if (actionMenu) onDetail(actionMenu.patient); setActionMenu(null); }}>View history</MenuItem>}
        {(role === "admin" || role === "receptionist") && <MenuItem onClick={() => { if (actionMenu) setEditing(actionMenu.patient); setActionMenu(null); }}>Edit patient</MenuItem>}
        {(role === "admin" || role === "receptionist") && actionMenu?.patient.phone && (
          <MenuItem onClick={() => { if (actionMenu) void toggleConsent(actionMenu.patient); setActionMenu(null); }}>
            {actionMenu.patient.whatsapp_opt_in ? "Turn off WhatsApp reminders" : "Turn on WhatsApp reminders"}
          </MenuItem>
        )}
        {actionMenu?.patient.phone && (
          <MenuItem onClick={() => { if (actionMenu) setMessageTarget(actionMenu.patient); setActionMenu(null); }}>
            Send WhatsApp message
          </MenuItem>
        )}
        {isAdmin && <MenuItem onClick={() => { if (actionMenu) setToDelete(actionMenu.patient); setActionMenu(null); }}>Delete patient</MenuItem>}
      </Menu>

      {messageTarget && (
        <SendMessageDialog
          token={token}
          patient={messageTarget}
          mode={sender?.source === "coexistence" ? "api" : "link"}
          countryCode={sender?.country_code ?? "91"}
          onClose={() => setMessageTarget(null)}
          onSent={() => load()}
          toast={setToast}
        />
      )}

      <Dialog open={!!toDelete} onClose={() => setToDelete(null)}>
        <DialogTitle>Delete patient?</DialogTitle>
        <DialogContent><Typography variant="body2" color="text.secondary">Patients with visits or invoices cannot be deleted; the record is preserved. Otherwise the record is soft-deleted and hidden.</Typography></DialogContent>
        <DialogActions><Button onClick={() => setToDelete(null)}>Cancel</Button><Button color="error" variant="contained" onClick={() => void remove()}>Delete</Button></DialogActions>
      </Dialog>
    </CardContent></Card>
  );
}

function PatientForm({ token, initial, isAdmin, onClose, onDetail, onSaved }: {
  token: string; initial: PatientRow | null; isAdmin: boolean; onClose: () => void;
  onDetail?: (p: PatientRow) => void; onSaved: (msg: string) => void;
}) {
  // Portal login (admin only). New patients may opt in; existing logins can be edited, disabled or reset.
  const [wantsLogin, setWantsLogin] = useState(false);

  const [loginPassword, setLoginPassword] = useState("");
  const [loginActive, setLoginActive] = useState(true);
  const hasLogin = !!initial?.has_login;
  const [resetPassword, setResetPassword] = useState("");
  const [firstName, setFirstName] = useState(initial?.first_name ?? "");
  const [lastName, setLastName] = useState(initial?.last_name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  // Sign-in phone for the portal. Defaults to the patient's phone; admin may change it.
  const [loginPhone, setLoginPhone] = useState(initial?.login_phone ?? initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [sex, setSex] = useState(initial?.sex ?? "female");
  const [dob, setDob] = useState(initial?.date_of_birth ? String(initial.date_of_birth).slice(0, 10) : "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [allergies, setAllergies] = useState(initial?.allergies_summary ?? "");
  const [whatsappOptIn, setWhatsappOptIn] = useState(initial?.whatsapp_opt_in ?? false);
  const [ecName, setEcName] = useState(initial?.emergency_contact_name ?? "");
  const [ecPhone, setEcPhone] = useState(initial?.emergency_contact_phone ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [remoteChanged, setRemoteChanged] = useState(false);

  // Duplicate patient warning state
  const [duplicates, setDuplicates] = useState<DuplicatePatientMatch[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [dismissedDuplicates, setDismissedDuplicates] = useState(false);
  const [confirmDuplicateOpen, setConfirmDuplicateOpen] = useState(false);
  const duplicateRequest = useRef(0);

  const loadDuplicates = useCallback(async () => {
    const id = ++duplicateRequest.current;
    const pTrim = phone.trim();
    const fTrim = firstName.trim();
    const lTrim = lastName.trim();
    const dTrim = dob.trim();

    if (pTrim.length < 6 && fTrim.length < 2) {
      setDuplicates([]);
      setCheckingDuplicates(false);
      return;
    }

    setCheckingDuplicates(true);
    try {
      const res = await patientApi.checkDuplicates(token, {
        phone: pTrim || undefined,
        first_name: fTrim || undefined,
        last_name: lTrim || undefined,
        date_of_birth: dTrim || undefined,
        exclude_id: initial?.id,
      });
      if (id === duplicateRequest.current) setDuplicates(res.data.duplicates || []);
    } catch {} finally { if (id === duplicateRequest.current) setCheckingDuplicates(false); }
  }, [token, phone, firstName, lastName, dob, initial?.id]);
  useEffect(() => {
    setDismissedDuplicates(false);
    const timer = setTimeout(() => { void loadDuplicates(); }, 350);
    return () => { clearTimeout(timer); ++duplicateRequest.current; };
  }, [loadDuplicates]);
  useLiveRefresh(async () => {
    await loadDuplicates();
    if (!initial) return;
    try {
      const { data } = await patientApi.get(token, initial.id);
      setRemoteChanged(data.updated_at !== initial.updated_at);
    } catch { setErr("Could not check the latest patient record. Your draft is unchanged."); }
  });

  const payload: Partial<PatientRow> = {
    first_name: firstName.trim(), last_name: lastName.trim() || undefined, phone: phone.trim(),
    email: email.trim() || undefined, sex, date_of_birth: dob || undefined, address: address.trim() || undefined,
    allergies_summary: allergies.trim() || undefined, emergency_contact_name: ecName.trim() || undefined, emergency_contact_phone: ecPhone.trim() || undefined,
    whatsapp_opt_in: whatsappOptIn,
  };

  // Login fields are only sent by admins; the server enforces this too.
  const loginFields: Record<string, unknown> = {};
  if (isAdmin) {
    if (!hasLogin && wantsLogin) {
      loginFields.login_phone = loginPhone.trim();
      loginFields.login_password = loginPassword;
    }
    if (hasLogin) {
      loginFields.login_active = loginActive;
      // Send the sign-in phone only when it actually changed.
      if (loginPhone.trim() && loginPhone.trim() !== (initial?.login_phone ?? "")) loginFields.login_phone = loginPhone.trim();
    }
  }

  const doActualSave = async () => {
    setErr(""); setBusy(true);
    try {
      if (initial) await patientApi.update(token, initial.id, { ...payload, ...loginFields } as Partial<PatientRow>, photo, removePhoto);
      else await patientApi.create(token, { ...payload, ...loginFields } as Partial<PatientRow>, photo);
      onSaved(initial ? "Patient updated" : "Patient registered");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); setConfirmDuplicateOpen(false); }
  };

  const handleSaveClick = () => {
    if (!initial && duplicates.length > 0 && !dismissedDuplicates) {
      setConfirmDuplicateOpen(true);
      return;
    }
    void doActualSave();
  };

  const doReset = async () => {
    if (!initial) return;
    setErr(""); setBusy(true);
    try {
      await patientApi.resetPortalPassword(token, initial.id, resetPassword);
      setResetPassword("");
      onSaved("Portal password reset; patient sessions revoked");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Reset failed"); }
    finally { setBusy(false); }
  };

  const loginValid = !isAdmin || !wantsLogin || (!hasLogin && loginPhone.replace(/\D/g, "").length >= 10 && loginPassword.length >= PASSWORD_MIN);

  return (
    <>
      <Dialog open onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>{initial ? "Edit patient" : "Add patient"}</DialogTitle>
        <DialogContent>
          {remoteChanged && <Alert severity="warning" sx={{ mb: 2 }}>This patient changed elsewhere. Your draft is unchanged. Reopen the form to review the latest record before saving.</Alert>}
          {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
          <Box sx={{ mb: 2 }}>
            <AvatarPicker file={photo} onChange={(f) => { setPhoto(f); if (f) setRemovePhoto(false); }} currentSrcLabel={initials2(firstName || "?")} disabled={busy} />
            {initial?.has_avatar && !photo && (
              <Button size="small" color="warning" sx={{ mt: 1 }} onClick={() => setRemovePhoto((v) => !v)}>{removePhoto ? "Keep current photo" : "Remove current photo"}</Button>
            )}
          </Box>
          <Box className="two-fields"><TextField autoFocus fullWidth required label="First name *" value={firstName} onChange={(e) => setFirstName(e.target.value)} /><TextField fullWidth label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} /></Box>
          <Box className="two-fields"><TextField label="Phone *" required value={phone} onChange={(e) => setPhone(e.target.value)} helperText={checkingDuplicates ? "Checking for duplicates..." : undefined} /><TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} /></Box>
          <Box className="two-fields">
            <TextField select label="Sex" value={sex} onChange={(e) => setSex(e.target.value)}>
              <MenuItem value="female">Female</MenuItem><MenuItem value="male">Male</MenuItem><MenuItem value="other">Other</MenuItem><MenuItem value="prefer_not_to_say">Prefer not to say</MenuItem>
            </TextField>
            <TextField type="date" label="Date of birth" value={dob} onChange={(e) => setDob(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Box>

          {/* Proactive Duplicate Warning Box */}
          {duplicates.length > 0 && !dismissedDuplicates && (
            <Alert
              severity="warning"
              sx={{ mt: 2, mb: 1, border: "1px solid #ffd591", bgcolor: "#fffbe6" }}
              action={
                <Button color="inherit" size="small" onClick={() => setDismissedDuplicates(true)}>
                  Dismiss
                </Button>
              }
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "#873800" }}>
                Possible duplicate patient found ({duplicates.length})
              </Typography>
              <Typography variant="caption" sx={{ display: "block", color: "#614700", mb: 1 }}>
                An existing patient matches the entered details. Please verify to avoid duplicates:
              </Typography>
              <Stack spacing={1}>
                {duplicates.map((d) => (
                  <Box key={d.id} sx={{ p: 1, bgcolor: "#ffffff", borderRadius: 1.5, border: "1px solid #ffe58f", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={700}>
                        {d.first_name} {d.last_name || ""} ({d.patient_number})
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        Phone: {d.phone || "—"} | DOB: {d.date_of_birth || "—"}
                      </Typography>
                      <Typography variant="caption" sx={{ color: "#d46b08", fontWeight: 600 }}>
                        {d.match_reasons.join(", ")}
                      </Typography>
                    </Box>
                    {onDetail && (
                      <Button
                        size="small"
                        variant="outlined"
                        color="warning"
                        onClick={() => {
                          onClose();
                          onDetail(d as unknown as PatientRow);
                        }}
                      >
                        View profile
                      </Button>
            )}
                  </Box>
                ))}
              </Stack>
            </Alert>
          )}

          <TextField fullWidth label="Allergies summary" value={allergies} onChange={(e) => setAllergies(e.target.value)} sx={{ mt: 2 }} />
          <TextField fullWidth label="Address" value={address} onChange={(e) => setAddress(e.target.value)} sx={{ mt: 2 }} />
          <Box className="two-fields"><TextField label="Emergency contact" value={ecName} onChange={(e) => setEcName(e.target.value)} /><TextField label="Emergency phone" value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} /></Box>

          <FormControlLabel
            sx={{ mt: 1.5 }}
            control={<Switch checked={whatsappOptIn} onChange={(e) => setWhatsappOptIn(e.target.checked)} disabled={!phone.trim()} />}
            label={
              <Box>
                <Typography variant="body2">Send WhatsApp reminders</Typography>
                <Typography variant="caption" color="text.secondary">
                  {phone.trim() ? "Appointment reminders and updates go to this number." : "Add a phone number first."}
                </Typography>
              </Box>
            }
          />

          {isAdmin && (
            <Box sx={{ mt: 2, p: 2, borderRadius: 2, border: "1px solid #e5ece8" }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Patient portal login <Typography component="span" variant="caption" color="text.secondary">(admin only)</Typography></Typography>
              {!hasLogin && (
                <>
                  <FormControlLabel control={<Switch checked={wantsLogin} onChange={(e) => setWantsLogin(e.target.checked)} />} label="Create a login so this patient can sign in" />
                  {wantsLogin && (
                    <Box className="two-fields">
                      <TextField label="Login phone number *" value={loginPhone} onChange={(e) => setLoginPhone(e.target.value)} helperText="Patient signs in with this number" inputProps={{ inputMode: "tel" }} />
                      <TextField label={`Temporary password * (min ${PASSWORD_MIN})`} type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} autoComplete="new-password" />
                    </Box>
                  )}
                </>
              )}
              {hasLogin && (
                <>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
                    <FormControlLabel control={<Switch checked={loginActive} onChange={(e) => setLoginActive(e.target.checked)} />} label={loginActive ? "Portal access enabled" : "Portal access disabled"} />
                    <TextField label="Login phone number" value={loginPhone} onChange={(e) => setLoginPhone(e.target.value)} helperText="Patient signs in with this number" inputProps={{ inputMode: "tel" }} sx={{ flex: 1 }} />
                  </Stack>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 1.5 }} alignItems={{ sm: "center" }}>
                    <TextField label={`New portal password (min ${PASSWORD_MIN})`} type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} sx={{ flex: 1 }} autoComplete="new-password" />
                    <Button variant="outlined" color="warning" disabled={busy || resetPassword.length < PASSWORD_MIN} onClick={() => void doReset()}>Reset password</Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Resetting the password signs the patient out everywhere.</Typography>
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" disabled={!firstName.trim() || !phone.trim() || busy || !loginValid} onClick={handleSaveClick}>
            {busy ? <CircularProgress size={18} /> : initial ? "Save changes" : "Register patient"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirmation Dialog when duplicates exist and user clicks Register */}
      <Dialog open={confirmDuplicateOpen} onClose={() => setConfirmDuplicateOpen(false)} maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 700 }}>Potential duplicate warning</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            One or more existing patients match the phone number or name you entered. The clinic policy recommends manual verification before creating a new record.
          </Typography>
          <Typography variant="body2" sx={{ mt: 1.5, fontWeight: 600 }}>
            Do you want to confirm and register a new patient record anyway?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDuplicateOpen(false)}>Review details</Button>
          <Button variant="contained" color="warning" onClick={() => void doActualSave()}>
            Confirm & register new
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function initials2(name: string) {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}

// Keep the Avatar import used for typing parity with other lists.
export const _AvatarRef = Avatar;
