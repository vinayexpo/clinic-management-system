import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
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
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { IconPlus } from "@tabler/icons-react";
import { WorkingHoursDialog } from "../components/WorkingHoursDialog";
import { PASSWORD_MIN, doctorApi, userApi, type ApiUser, type Paginated, type UserRole, type StaffInput, type DoctorRow } from "../api";
import { AvatarPicker, FilterSelect, PagerBar, PersonAvatar, SearchField, useDebounced } from "../components/common";
import { istDateTime } from "../lib/ist";
import { useLiveRefresh } from "../lib/realtime";

const ROLE_LABEL: Record<UserRole, string> = { admin: "Administrator", doctor: "Doctor", receptionist: "Receptionist", patient: "Patient" };

/**
 * Admin-only staff management: create doctors/receptionists/admins, edit, upload
 * profile photos, deactivate or reactivate. Filters and pagination are server-side.
 */
export function StaffPage({ token, selfId }: { token: string; selfId: number }) {
  const [rows, setRows] = useState<Paginated<ApiUser> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [specializations, setSpecializations] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [editing, setEditing] = useState<ApiUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [hours, setHours] = useState<{ doctorId: number; name: string } | null>(null);
  const [actionMenu, setActionMenu] = useState<{ anchor: HTMLElement; user: ApiUser } | null>(null);

  const debounced = useDebounced(search);
  const request = useRef(0);
  useEffect(() => { setPage(1); }, [debounced, role, status, specialization, perPage]);
  useEffect(() => {
    doctorApi.list(token, { all: true }).then((res) => {
      const list = (res as unknown as { data: DoctorRow[] }).data;
      setSpecializations(Array.from(new Set(list.map((d) => d.specialization).filter((x): x is string => !!x))).sort());
    }).catch(() => setSpecializations([]));
  }, [token]);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError("");
    try {
      const res = await userApi.list(token, {
        page, per_page: perPage, search: debounced || undefined,
        role: (role || undefined) as UserRole | undefined,
        is_active: status === "" ? undefined : status === "active",
        specialization: specialization || undefined,
        sort: "name", direction: "asc",
      });
      if (id !== request.current) return;
      setRows((res as unknown as { data: Paginated<ApiUser> }).data);
    } catch (e: unknown) { if (id === request.current) setError(e instanceof Error ? e.message : "Failed to load staff."); }
    finally { if (id === request.current) setLoading(false); }
  }, [token, page, perPage, debounced, role, status, specialization]);

  useEffect(() => { void load(); return () => { ++request.current; }; }, [load]);
  useLiveRefresh(async () => {
    await Promise.all([
      load(),
      doctorApi.list(token, { all: true }).then((res) => {
        const list = (res as unknown as { data: DoctorRow[] }).data;
        setSpecializations(Array.from(new Set(list.map((d) => d.specialization).filter((x): x is string => !!x))).sort());
      }),
    ]);
    if (actionMenu) {
      const { data } = await userApi.get(token, actionMenu.user.id);
      setActionMenu((current) => current?.user.id === data.id ? { ...current, user: data } : current);
    }
  });
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 2600); return () => clearTimeout(t); } }, [toast]);

  /** A doctor's schedule is keyed by the doctor profile, not the user. Resolve it, then open the editor. */
  const openHours = async (u: ApiUser) => {
    try {
      const res = await userApi.get(token, u.id);
      const doctor = (res as unknown as { data: ApiUser & { doctor?: { id: number } | null } }).data.doctor;
      if (!doctor) { setToast(`${u.name} has no doctor profile. Recreate the account as a doctor.`); return; }
      setHours({ doctorId: doctor.id, name: u.name });
    } catch (e: unknown) { setToast(e instanceof Error ? e.message : "Could not open working hours"); }
  };

  const deactivate = async (u: ApiUser) => {
    try { await userApi.deactivate(token, u.id); setToast(`${u.name} deactivated`); void load(); }
    catch (e: unknown) { setToast(e instanceof Error ? e.message : "Action failed"); }
  };
  const reactivate = async (u: ApiUser) => {
    try { await userApi.reactivate(token, u.id); setToast(`${u.name} reactivated`); void load(); }
    catch (e: unknown) { setToast(e instanceof Error ? e.message : "Action failed"); }
  };

  const items = rows?.data ?? [];

  return (
    <Card><CardContent>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ md: "center" }} sx={{ mb: 2 }}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", flex: 1 }}>
          <SearchField value={search} onChange={setSearch} placeholder="Search name, email or phone" />
          <FilterSelect label="Role" value={role} onChange={setRole} width={170} options={[
            { value: "admin", label: "Administrator" }, { value: "doctor", label: "Doctor" }, { value: "receptionist", label: "Receptionist" },
          ]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} width={150} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
          <FilterSelect label="Doctor specialty" value={specialization} onChange={setSpecialization} width={190} options={specializations.map((value) => ({ value, label: value }))} />
        </Stack>
        <Button variant="contained" startIcon={<IconPlus size={16} />} onClick={() => setCreating(true)}>Add staff</Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {toast && <Alert severity="info" sx={{ mb: 2 }}>{toast}</Alert>}
      {loading && !rows && <Box sx={{ display: "grid", placeItems: "center", py: 6 }}><CircularProgress /></Box>}

      <Box className="desktop-data-table table-scroll" role="region" aria-label="Staff table" tabIndex={0}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Email</TableCell><TableCell>Phone</TableCell><TableCell>Role</TableCell><TableCell>Status</TableCell><TableCell>Last login</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
          <TableBody>
            {items.map((u) => (
              <TableRow key={u.id} hover>
                <TableCell><Stack direction="row" spacing={1.5} alignItems="center"><PersonAvatar token={token} endpoint={`/users/${u.id}/avatar`} name={u.name} hasAvatar={u.has_avatar} size={34} cacheKey={u.id} /><Box><Typography fontWeight={700}>{u.name}</Typography>{u.doctor?.specialization && <Typography variant="caption" color="text.secondary">{u.doctor.specialization}</Typography>}</Box></Stack></TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>{u.phone || "—"}</TableCell>
                <TableCell><Chip size="small" variant="outlined" label={ROLE_LABEL[u.role]} /></TableCell>
                <TableCell><Chip size="small" label={u.is_active ? "Active" : "Inactive"} color={u.is_active ? "success" : "default"} /></TableCell>
                <TableCell>{u.last_login_at ? istDateTime(u.last_login_at) : "Never"}</TableCell>
                <TableCell align="right"><Button size="small" aria-label={`Actions for ${u.name}`} onClick={(e) => setActionMenu({ anchor: e.currentTarget, user: u })}>Actions</Button></TableCell>
              </TableRow>
            ))}
            {!loading && items.length === 0 && <TableRow><TableCell colSpan={7}><Typography color="text.secondary" sx={{ py: 2 }}>No staff match these filters.</Typography></TableCell></TableRow>}
          </TableBody>
        </Table>
      </Box>

      <Box className="mobile-record-list" aria-label="Staff list">
        {!loading && items.length === 0 && <Box className="mobile-record-card"><Typography color="text.secondary">No staff match these filters.</Typography></Box>}
        {items.map((u) => (
          <Box className="mobile-record-card" key={u.id}>
            <Box className="mobile-record-main"><Box className="mobile-record-person"><PersonAvatar token={token} endpoint={`/users/${u.id}/avatar`} name={u.name} hasAvatar={u.has_avatar} size={38} cacheKey={u.id} /><Box><Typography fontWeight={700}>{u.name}</Typography><Typography variant="caption" color="text.secondary">{u.email}</Typography></Box></Box><Chip size="small" label={u.is_active ? "Active" : "Inactive"} color={u.is_active ? "success" : "default"} /></Box>
            <Box className="mobile-record-meta"><span>Role</span><Typography variant="body2">{ROLE_LABEL[u.role]}</Typography><span>Phone</span><Typography variant="body2">{u.phone || "—"}</Typography></Box>
            <Button className="mobile-record-action" aria-label={`Actions for ${u.name}`} onClick={(e) => setActionMenu({ anchor: e.currentTarget, user: u })}>Actions</Button>
          </Box>
        ))}
      </Box>

      {rows && rows.total > 0 && <PagerBar page={rows.current_page} lastPage={rows.last_page} total={rows.total} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />}

      <Menu anchorEl={actionMenu?.anchor} open={!!actionMenu} onClose={() => setActionMenu(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        <MenuItem onClick={() => { if (actionMenu) setEditing(actionMenu.user); setActionMenu(null); }}>Edit account</MenuItem>
        {actionMenu?.user.role === "doctor" && <MenuItem onClick={() => { if (actionMenu) void openHours(actionMenu.user); setActionMenu(null); }}>Working hours</MenuItem>}
        {actionMenu?.user.is_active
          ? <MenuItem disabled={actionMenu.user.id === selfId} onClick={() => { if (actionMenu) void deactivate(actionMenu.user); setActionMenu(null); }}>Deactivate account</MenuItem>
          : <MenuItem onClick={() => { if (actionMenu) void reactivate(actionMenu.user); setActionMenu(null); }}>Reactivate account</MenuItem>}
      </Menu>

      {hours && (
        <WorkingHoursDialog token={token} doctorId={hours.doctorId} doctorName={hours.name}
          onClose={() => setHours(null)}
          onSaved={(msg) => { setHours(null); setToast(msg); }} />
      )}

      {(creating || editing) && (
        <StaffForm token={token} initial={editing} selfId={selfId}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(msg) => { setCreating(false); setEditing(null); setToast(msg); void load(); }} />
      )}
    </CardContent></Card>
  );
}

function StaffForm({ token, initial, selfId, onClose, onSaved }: {
  token: string; initial: ApiUser | null; selfId: number; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [password, setPassword] = useState("");
  const [roleValue, setRoleValue] = useState<UserRole>(initial?.role ?? "receptionist");
  const [active, setActive] = useState(initial?.is_active ?? true);
  const [qualification, setQualification] = useState(initial?.doctor?.qualification ?? "");
  const [specialization, setSpecialization] = useState(initial?.doctor?.specialization ?? "");
  const [registration, setRegistration] = useState(initial?.doctor?.registration_number ?? "");
  const [fee, setFee] = useState(String(initial?.doctor?.consultation_fee ?? "0"));
  const [photo, setPhoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isSelf = initial?.id === selfId;
  const dirty = useRef(false);
  const baseline = useRef("");
  const [remoteChanged, setRemoteChanged] = useState(false);
  useLiveRefresh(async () => {
    if (!initial) return;
    try {
      const { data } = await userApi.get(token, initial.id);
      if (baseline.current) setRemoteChanged(JSON.stringify(data) !== baseline.current);
    } catch { setErr("Could not check the latest account. Your draft is unchanged."); }
  }, !!initial);

  useEffect(() => {
    if (!initial) return;
    let alive = true;
    userApi.get(token, initial.id).then((res) => {
      const user = (res as unknown as { data: ApiUser & { doctor?: { qualification?: string | null; specialization?: string | null; registration_number?: string | null; consultation_fee?: string | number } | null } }).data;
      if (!alive) return;
      baseline.current = JSON.stringify(user);
      if (dirty.current) return;
      setName(user.name); setEmail(user.email); setPhone(user.phone ?? ""); setActive(user.is_active); setRoleValue(user.role);
      setQualification(user.doctor?.qualification ?? "");
      setSpecialization(user.doctor?.specialization ?? "");
      setRegistration(user.doctor?.registration_number ?? "");
      setFee(String(user.doctor?.consultation_fee ?? "0"));
    }).catch((e: unknown) => { if (alive) setErr(e instanceof Error ? e.message : "Could not load this account."); });
    return () => { alive = false; };
  }, [token, initial]);

  const save = async () => {
    setErr(""); setBusy(true);
    const data: Partial<StaffInput> = {
      name: name.trim(), email: email.trim(), phone: phone.trim() || undefined, role: roleValue,
      is_active: active,
      ...(password ? { password } : {}),
      ...(roleValue === "doctor" ? { qualification: qualification || undefined, specialization: specialization || undefined, registration_number: registration || undefined, consultation_fee: Number(fee) || 0 } : {}),
    };
    try {
      if (initial) await userApi.update(token, initial.id, data, photo, removePhoto);
      else await userApi.create(token, { ...data, password } as StaffInput, photo);
      onSaved(initial ? "Staff updated" : "Staff account created");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{initial ? `Edit ${initial.name}` : "Add staff account"}</DialogTitle>
      <DialogContent onChangeCapture={() => { dirty.current = true; }}>
        {remoteChanged && <Alert severity="warning" sx={{ mb: 2 }}>This account changed elsewhere. Your draft is unchanged. Reopen the form to review the latest record before saving.</Alert>}
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        <Box sx={{ mb: 2 }}>
          <AvatarPicker file={photo} onChange={(f) => { setPhoto(f); if (f) setRemovePhoto(false); }} currentSrcLabel={name ? name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() : "?"} disabled={busy} />
          {initial?.has_avatar && !photo && <Button size="small" color="warning" sx={{ mt: 1 }} onClick={() => setRemovePhoto((v) => !v)}>{removePhoto ? "Keep current photo" : "Remove current photo"}</Button>}
        </Box>
        <TextField fullWidth required label="Full name *" value={name} onChange={(e) => setName(e.target.value)} sx={{ mb: 2 }} />
        <Box className="two-fields"><TextField required label="Email *" value={email} onChange={(e) => setEmail(e.target.value)} /><TextField label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></Box>
        <Box className="two-fields">
          <TextField select label="Role *" value={roleValue} onChange={(e) => { dirty.current = true; setRoleValue(e.target.value as UserRole); }} disabled={isSelf}>
            <MenuItem value="admin">Administrator</MenuItem><MenuItem value="doctor">Doctor</MenuItem><MenuItem value="receptionist">Receptionist</MenuItem>
          </TextField>
          <TextField select label="Status" value={active ? "active" : "inactive"} onChange={(e) => { dirty.current = true; setActive(e.target.value === "active"); }} disabled={isSelf}>
            <MenuItem value="active">Active</MenuItem><MenuItem value="inactive">Inactive</MenuItem>
          </TextField>
        </Box>
        <TextField fullWidth sx={{ mt: 2 }} type="password" label={initial ? "New password (leave blank to keep)" : `Password * (min ${PASSWORD_MIN} characters)`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        {roleValue === "doctor" && (
          <Box sx={{ mt: 2, p: 2, borderRadius: 2, border: "1px solid #e5ece8" }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Doctor profile</Typography>
            <Box className="two-fields"><TextField label="Qualification" value={qualification} onChange={(e) => setQualification(e.target.value)} placeholder="MBBS, MD" /><TextField label="Specialization" value={specialization} onChange={(e) => setSpecialization(e.target.value)} /></Box>
            <Box className="two-fields"><TextField label="Registration number" value={registration} onChange={(e) => setRegistration(e.target.value)} /><TextField type="number" label="Consultation fee (₹)" value={fee} onChange={(e) => setFee(e.target.value)} /></Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !name.trim() || !email.trim() || (!initial && password.length < PASSWORD_MIN) || (!!password && password.length < PASSWORD_MIN)} onClick={() => void save()}>
          {busy ? <CircularProgress size={18} /> : initial ? "Save changes" : "Create account"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
