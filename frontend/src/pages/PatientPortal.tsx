import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppBar,
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
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Popover,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Toolbar,
  Typography,
} from "@mui/material";
import {
  IconCalendarEvent,
  IconCalendarPlus,
  IconClipboardHeart,
  IconEye,
  IconLogout,
  IconPill,
  IconPrinter,
  IconReceipt,
  IconStethoscope,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import {
  clinicApi,
  doctorApi,
  fetchAvatarUrl,
  portalApi,
  type AppointmentRow,
  type DoctorRow,
  type InvoiceRow,
  type PatientRow,
  type Paginated,
  type PrescriptionRow,
  type VisitRow,
} from "../api";
import { PagerBar, PersonAvatar, AvatarPicker, initials } from "../components/common";
import { NotificationBellButton, NotificationList, PushToggle } from "../components/NotificationParts";
import { useNotifications } from "../lib/notifications";
import { useAuth } from "../AuthContext";
import { useClinicLogo } from "../lib/clinicLogo";
import { useLiveRefresh } from "../lib/realtime";
import { istDate, istTime24 } from "../lib/ist";

export type PortalTab = "profile" | "appointments" | "visits" | "prescriptions" | "invoices";

const PORTAL_TABS = [
  { value: "profile" as const, label: "Profile", icon: <IconUser size={20} /> },
  { value: "appointments" as const, label: "Appointments", icon: <IconCalendarEvent size={20} /> },
  { value: "visits" as const, label: "Visits", icon: <IconClipboardHeart size={20} /> },
  { value: "prescriptions" as const, label: "Prescriptions", icon: <IconPill size={20} /> },
  { value: "invoices" as const, label: "Bills", icon: <IconReceipt size={20} /> },
];

function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(val: unknown): string {
  const n = Number(val);
  return `₹ ${Number.isFinite(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "0"}`;
}

/**
 * Patient self-service portal. Everything shown is the signed-in patient's own data;
 * the server resolves the record from the login, so no patient id is sent.
 */
export function PatientPortal() {
  const auth = useAuth();
  const token = auth.token!;
  const [tab, setTab] = useState<PortalTab>("profile");
  const [initialRx, setInitialRx] = useState<PrescriptionRow | null>(null);
  const [me, setMe] = useState<PatientRow | null>(null);
  const [error, setError] = useState("");
  const [notifAnchor, setNotifAnchor] = useState<null | HTMLElement>(null);
  const notifications = useNotifications(token, "patient");
  const meRequest = useRef(0);
  const [clinicName, setClinicName] = useState("Carehaven Clinic");
  const [hasLogo, setHasLogo] = useState(false);
  const clinicLogoUrl = useClinicLogo(token, hasLogo);

  useEffect(() => {
    clinicApi.status(token)
      .then((res) => {
        const payload = (res as unknown as { data: { clinic_name?: string; has_logo?: boolean } }).data;
        if (payload?.clinic_name) setClinicName(payload.clinic_name);
        if (payload?.has_logo != null) setHasLogo(payload.has_logo);
      })
      .catch(() => {});
  }, [token]);

  const name = me ? [me.first_name, me.last_name].filter(Boolean).join(" ") : auth.user?.name ?? "";

  const reloadMe = useCallback(() => {
    const id = ++meRequest.current;
    return portalApi.me(token)
      .then((r) => { if (id === meRequest.current) { setMe((r as unknown as { data: PatientRow }).data); setError(""); } })
      .catch((e: unknown) => { if (id === meRequest.current) setError(e instanceof Error ? e.message : "Could not load your record."); });
  }, [token]);
  useEffect(() => { void reloadMe(); return () => { ++meRequest.current; }; }, [reloadMe]);
  useLiveRefresh(reloadMe);

  return (
    <Box className="patient-portal-shell" sx={{ minHeight: "100vh", bgcolor: "#f5f7f4" }}>
      <AppBar position="sticky" color="transparent" elevation={0} sx={{ bgcolor: "#fff", borderBottom: "1px solid #e7eeeb" }}>
        <Toolbar sx={{ gap: 1.5 }}>
          {clinicLogoUrl ? (
            <Box component="img" src={clinicLogoUrl} alt="" sx={{ width: 36, height: 36, objectFit: "contain", borderRadius: 1 }} />
          ) : (
            <Box className="brand-mark" sx={{ width: 36, height: 36 }}><IconStethoscope size={18} /></Box>
          )}
          <Box sx={{ flex: 1 }}>
            <Typography fontWeight={700}>{clinicName} patient portal</Typography>
            <Typography variant="caption" color="text.secondary">Your appointments, prescriptions, visits and bills</Typography>
          </Box>
          <NotificationBellButton unread={notifications.unread} onClick={(event) => setNotifAnchor(event.currentTarget)} />
          <Button startIcon={<IconLogout size={16} />} onClick={() => auth.logout()}>Sign out</Button>
        </Toolbar>
      </AppBar>

      <Popover
        anchorEl={notifAnchor}
        open={!!notifAnchor}
        onClose={() => setNotifAnchor(null)}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        slotProps={{ paper: { sx: { width: 360, maxWidth: "calc(100vw - 24px)", mt: 1 } } }}
      >
        <Box sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" fontWeight={700}>Your Notifications</Typography>
          {notifications.unread > 0 && (
            <Button size="small" onClick={() => void notifications.markAllRead()} sx={{ fontSize: 12, textTransform: "none" }}>
              Mark all read
            </Button>
          )}
        </Box>
        <Divider />
        <Box sx={{ p: 1.5, maxHeight: 360, overflowY: "auto" }}>
          <NotificationList
            items={notifications.items}
            onSelect={(item) => {
              void notifications.markRead(item.id);
              setNotifAnchor(null);
              const p = (item.page ?? "").toLowerCase();
              const t = (item.type ?? "").toLowerCase();
              if (p === "appointments" || t.startsWith("appointment")) {
                setTab("appointments");
              } else if (p === "prescriptions" || t.startsWith("prescription")) {
                setTab("prescriptions");
              } else if (p === "bills" || p === "billing" || t.startsWith("invoice") || t.startsWith("payment")) {
                setTab("invoices");
              } else if (p === "visits" || t.startsWith("visit")) {
                setTab("visits");
              } else if (p === "profile") {
                setTab("profile");
              }
            }}
            emptyHint="Personal updates about your appointments, prescriptions, and bills appear here."
          />
        </Box>
        <Divider />
        <PushToggle
          supported={notifications.pushSupported}
          subscribed={notifications.pushState === "subscribed"}
          pushState={notifications.pushState}
          busy={notifications.pushBusy}
          message={notifications.pushMessage}
          onEnable={() => void notifications.enablePush()}
          onDisable={() => void notifications.disablePush()}
          fullWidth
        />
      </Popover>

      <Box className="patient-portal-content" sx={{ maxWidth: 1060, width: "100%", mx: "auto", p: { xs: 1.5, md: 3 }, pb: { xs: 5, md: 4 } }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Card sx={{ mb: 2 }}><CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <PersonAvatar token={token} endpoint={me ? `/patients/${me.id}/avatar` : "/portal/me"} name={name || "?"} hasAvatar={!!me?.has_avatar} size={56} cacheKey={me?.updated_at} />
            <Box>
              <Typography component="h1" variant="h5" sx={{ fontFamily: "Georgia, serif" }}>{name || "Welcome"}</Typography>
              {me && <Typography variant="body2" color="text.secondary">Patient ID {me.patient_number}, phone {me.phone}</Typography>}
              {me?.allergies_summary && <Chip size="small" color="warning" variant="outlined" label={`Allergies: ${me.allergies_summary}`} sx={{ mt: 1 }} />}
            </Box>
          </Stack>
        </CardContent></Card>

        <Tabs className="patient-portal-tabs" value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2 }}>
          {PORTAL_TABS.map((item) => (
            <Tab
              key={item.value}
              value={item.value}
              label={item.label}
              icon={item.icon}
              iconPosition="start"
              sx={{ minHeight: 48, fontWeight: 600 }}
            />
          ))}
        </Tabs>

        {tab === "profile" && <ProfileTab me={me} token={token} onChanged={reloadMe} />}
        {tab === "appointments" && <AppointmentsTab token={token} />}
        {tab === "visits" && (
          <VisitsTab
            token={token}
            onOpenPrescription={(rx) => {
              setInitialRx(rx);
              setTab("prescriptions");
            }}
          />
        )}
        {tab === "prescriptions" && <PrescriptionsTab token={token} initialPrescription={initialRx} />}
        {tab === "invoices" && <InvoicesTab token={token} />}
      </Box>

      <Box component="nav" className="mobile-portal-nav" aria-label="Patient portal navigation">
        {PORTAL_TABS.map((item) => {
          const active = tab === item.value;
          return (
            <Button
              key={item.value}
              aria-label={`Navigate to ${item.label}`}
              aria-current={active ? "page" : undefined}
              className={active ? "is-active" : ""}
              onClick={() => setTab(item.value)}
            >
              {item.icon}
              <span>{item.label}</span>
            </Button>
          );
        })}
      </Box>
    </Box>
  );
}

function ProfileTab({ me, token, onChanged }: { me: PatientRow | null; token: string; onChanged: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [currentPhoto, setCurrentPhoto] = useState<string | null>(null);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdError, setPwdError] = useState("");
  const [pwdSuccess, setPwdSuccess] = useState("");

  useEffect(() => {
    if (!me?.has_avatar) { setCurrentPhoto(null); return; }
    let url: string | null = null;
    let alive = true;
    fetchAvatarUrl(`/patients/${me.id}/avatar`, token).then((next) => {
      url = next;
      if (alive) setCurrentPhoto(next);
      else if (next) URL.revokeObjectURL(next);
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [me?.id, me?.has_avatar, me?.updated_at, token]);

  if (!me) return <CircularProgress />;

  const savePhoto = async () => {
    setBusy(true); setError("");
    try {
      await portalApi.updateMe(token, { remove_avatar: removePhoto && !file }, file);
      setFile(null); setRemovePhoto(false);
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save your photo.");
    } finally { setBusy(false); }
  };

  const changePassword = async () => {
    if (!currentPwd) { setPwdError("Please enter your current password."); return; }
    if (newPwd.length < 8) { setPwdError("New password must be at least 8 characters."); return; }
    if (newPwd !== confirmPwd) { setPwdError("New passwords do not match."); return; }
    setPwdBusy(true); setPwdError(""); setPwdSuccess("");
    try {
      await portalApi.updateMe(token, { current_password: currentPwd, password: newPwd });
      setPwdSuccess("Password updated successfully.");
      setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
    } catch (e: unknown) {
      setPwdError(e instanceof Error ? e.message : "Could not update password.");
    } finally { setPwdBusy(false); }
  };

  const rows: [string, string | null | undefined][] = [
    ["Patient ID", me.patient_number], ["Phone", me.phone], ["Email", me.email], ["Date of birth", me.date_of_birth ? String(me.date_of_birth).slice(0, 10) : null],
    ["Sex", me.sex], ["Address", me.address], ["Emergency contact", me.emergency_contact_name ? `${me.emergency_contact_name}, ${me.emergency_contact_phone ?? ""}` : null],
  ];
  return (
    <>
      <Card sx={{ mb: 2 }}><CardContent>
        <Typography component="h2" variant="h6" sx={{ mb: 1 }}>Profile photo</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Shown to clinic staff when they open your record.</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <AvatarPicker
          file={file}
          onChange={(next) => { setFile(next); if (next) setRemovePhoto(false); }}
          currentSrcLabel={initials([me.first_name, me.last_name].filter(Boolean).join(" "))}
          currentSrc={currentPhoto}
          disabled={busy}
        />
        {me.has_avatar && !file && (
          <Button size="small" color="warning" sx={{ mt: 1 }} onClick={() => setRemovePhoto((value) => !value)}>
            {removePhoto ? "Keep current photo" : "Remove current photo"}
          </Button>
        )}
        <Box sx={{ mt: 2 }}>
          <Button variant="contained" onClick={() => void savePhoto()} disabled={busy || (!file && !removePhoto)}>
            {busy ? "Saving..." : "Save photo"}
          </Button>
        </Box>
      </CardContent></Card>

      <Card sx={{ mb: 2 }}><CardContent>
        <Typography component="h2" variant="h6" sx={{ mb: 1 }}>Change portal password</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Update the password you use to sign in with your phone number ({me.phone}).</Typography>
        {pwdSuccess && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setPwdSuccess("")}>{pwdSuccess}</Alert>}
        {pwdError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPwdError("")}>{pwdError}</Alert>}
        <Stack spacing={2} sx={{ maxWidth: 440 }}>
          <TextField
            fullWidth
            size="small"
            type="password"
            label="Current password"
            value={currentPwd}
            onChange={(e) => setCurrentPwd(e.target.value)}
            disabled={pwdBusy}
          />
          <TextField
            fullWidth
            size="small"
            type="password"
            label="New password (min 8 characters)"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            disabled={pwdBusy}
          />
          <TextField
            fullWidth
            size="small"
            type="password"
            label="Confirm new password"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            disabled={pwdBusy}
            error={confirmPwd.length > 0 && newPwd !== confirmPwd}
            helperText={confirmPwd.length > 0 && newPwd !== confirmPwd ? "Passwords do not match" : ""}
          />
          <Box>
            <Button
              variant="contained"
              disabled={pwdBusy || !currentPwd || newPwd.length < 8 || newPwd !== confirmPwd}
              onClick={() => void changePassword()}
            >
              {pwdBusy ? "Updating password..." : "Update password"}
            </Button>
          </Box>
        </Stack>
      </CardContent></Card>

      <Card><CardContent>
        <Typography component="h2" variant="h6" sx={{ mb: 1 }}>Your details</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>To change these details, contact the clinic front desk.</Typography>
        <Box className="desktop-data-table table-scroll" role="region" aria-label="Your profile" tabIndex={0}><Table size="small"><TableBody>{rows.map(([k, v]) => (
          <TableRow key={k}><TableCell sx={{ width: 200, color: "text.secondary" }}>{k}</TableCell><TableCell>{v || "—"}</TableCell></TableRow>
        ))}</TableBody></Table></Box>
        <Box className="mobile-record-list" aria-label="Your profile">{rows.map(([label, value]) => <Box className="mobile-record-card" key={label}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="body2" fontWeight={600}>{value || "—"}</Typography></Box>)}</Box>
      </CardContent></Card>
    </>
  );
}

function usePaged<T>(load: (page: number, perPage: number) => Promise<Paginated<T>>) {
  const loader = useRef(load);
  loader.current = load;
  const request = useRef(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [data, setData] = useState<Paginated<T> | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const id = ++request.current;
    try {
      const next = await loader.current(page, perPage);
      if (id === request.current) { setData(next); setError(""); }
    } catch (e: unknown) {
      if (id === request.current) setError(e instanceof Error ? e.message : "Failed to load.");
    }
  }, [page, perPage]);
  useEffect(() => {
    void refresh();
    return () => { ++request.current; };
  }, [refresh]);
  useLiveRefresh(refresh);
  return { page, setPage, perPage, setPerPage, data, error, refresh };
}

function AppointmentsTab({ token }: { token: string }) {
  const { page, setPage, perPage, setPerPage, data, error, refresh } = usePaged<AppointmentRow>(
    async (p, n) => (await portalApi.appointments(token, { page: p, per_page: n }) as unknown as { data: Paginated<AppointmentRow> }).data
  );
  const [bookingOpen, setBookingOpen] = useState(false);
  const [cancelling, setCancelling] = useState<AppointmentRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [banner, setBanner] = useState("");

  const doCancel = async () => {
    if (!cancelling) return;
    setCancelBusy(true);
    try {
      await portalApi.cancelAppointment(token, cancelling.id, cancelReason || undefined);
      setCancelling(null);
      setCancelReason("");
      setBanner("Your appointment has been cancelled.");
      await refresh();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Could not cancel appointment.");
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <Card><CardContent>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5, mb: 2 }}>
        <Box>
          <Typography component="h2" variant="h6" fontWeight={700}>Your appointments</Typography>
          <Typography variant="body2" color="text.secondary">View scheduled appointments or book a consultation with our doctors.</Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<IconCalendarPlus size={18} />}
          onClick={() => setBookingOpen(true)}
          sx={{ fontWeight: 600 }}
        >
          Book appointment
        </Button>
      </Box>

      {banner && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setBanner("")}>{banner}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!data && !error && <CircularProgress />}

      {data && data.data.length === 0 && (
        <Box sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>
          <IconCalendarEvent size={36} style={{ opacity: 0.35, marginBottom: 8 }} />
          <Typography variant="body1" fontWeight={600}>No appointments scheduled</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            You do not have any upcoming or past appointments yet.
          </Typography>
          <Button variant="outlined" startIcon={<IconCalendarPlus size={18} />} onClick={() => setBookingOpen(true)}>
            Book your appointment
          </Button>
        </Box>
      )}

      {data && data.data.length > 0 && (
        <Box className="desktop-data-table table-scroll" role="region" aria-label="Your appointments" tabIndex={0}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date & Time</TableCell>
                <TableCell>Token</TableCell>
                <TableCell>Doctor</TableCell>
                <TableCell>Reason for visit</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((a) => {
                const canCancel = a.status === "booked";
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{String(a.appointment_date).slice(0, 10)}</Typography>
                      <Typography variant="caption" color="text.secondary">{String(a.start_time).slice(0, 5)}</Typography>
                    </TableCell>
                    <TableCell>
                      {a.token_number ? <Chip size="small" variant="outlined" label={`Token #${a.token_number}`} /> : "—"}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{a.doctor?.display_name ?? "Doctor"}</Typography>
                      {a.doctor?.specialization && <Typography variant="caption" color="text.secondary">{a.doctor.specialization}</Typography>}
                    </TableCell>
                    <TableCell>{a.reason_for_visit ?? "—"}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={String(a.status).replace(/_/g, " ")}
                        color={
                          a.status === "booked" ? "warning"
                            : a.status === "completed" ? "success"
                            : a.status === "cancelled" ? "default"
                            : "info"
                        }
                      />
                    </TableCell>
                    <TableCell align="right">
                      {canCancel && (
                        <Button
                          size="small"
                          color="error"
                          variant="text"
                          startIcon={<IconX size={14} />}
                          onClick={() => { setCancelling(a); setCancelReason(""); }}
                        >
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}

      {data && data.data.length > 0 && (
        <Box className="mobile-record-list" aria-label="Your appointments">
          {data.data.map((a) => {
            const canCancel = a.status === "booked";
            return (
              <Box className="mobile-record-card" key={a.id}>
                <Box className="mobile-record-main">
                  <Box>
                    <Typography fontWeight={700}>{String(a.appointment_date).slice(0, 10)}</Typography>
                    <Typography variant="body2" color="text.secondary">{String(a.start_time).slice(0, 5)}</Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={String(a.status).replace(/_/g, " ")}
                    color={
                      a.status === "booked" ? "warning"
                        : a.status === "completed" ? "success"
                        : a.status === "cancelled" ? "default"
                        : "info"
                    }
                  />
                </Box>
                <Typography variant="body2" fontWeight={600}>{a.doctor?.display_name ?? "Doctor"}</Typography>
                {a.doctor?.specialization && <Typography variant="caption" color="text.secondary" display="block">{a.doctor.specialization}</Typography>}
                <Typography variant="body2" color="text.secondary">{a.reason_for_visit ?? "No reason provided"}</Typography>
                {a.token_number && <Typography variant="caption" color="primary" fontWeight={600}>Token #{a.token_number}</Typography>}
                {canCancel && (
                  <Box sx={{ mt: 1, pt: 1, borderTop: "1px solid #edf2f0" }}>
                    <Button
                      size="small"
                      color="error"
                      startIcon={<IconX size={14} />}
                      onClick={() => { setCancelling(a); setCancelReason(""); }}
                    >
                      Cancel appointment
                    </Button>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {data && <PagerBar page={data.current_page} lastPage={data.last_page} total={data.total} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />}

      {/* Book appointment dialog */}
      <BookAppointmentDialog
        open={bookingOpen}
        token={token}
        onClose={() => setBookingOpen(false)}
        onBooked={() => {
          setBookingOpen(false);
          setBanner("Your appointment has been successfully booked!");
          void refresh();
        }}
      />

      {/* Cancel confirmation dialog */}
      <Dialog open={!!cancelling} onClose={() => { if (!cancelBusy) setCancelling(null); }} maxWidth="xs" fullWidth>
        <DialogTitle>Cancel appointment</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Are you sure you want to cancel your appointment with <strong>{cancelling?.doctor?.display_name ?? "the doctor"}</strong> on {String(cancelling?.appointment_date).slice(0, 10)} at {String(cancelling?.start_time).slice(0, 5)}?
          </Typography>
          <TextField
            fullWidth
            label="Reason for cancellation (optional)"
            size="small"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            disabled={cancelBusy}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelling(null)} disabled={cancelBusy}>Keep appointment</Button>
          <Button color="error" variant="contained" onClick={() => void doCancel()} disabled={cancelBusy}>
            {cancelBusy ? "Cancelling..." : "Cancel appointment"}
          </Button>
        </DialogActions>
      </Dialog>
    </CardContent></Card>
  );
}

function BookAppointmentDialog({
  open,
  token,
  onClose,
  onBooked,
}: {
  open: boolean;
  token: string;
  onClose: () => void;
  onBooked: () => void;
}) {
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [doctorId, setDoctorId] = useState<number | "">("");
  const todayIso = istDate();
  const [date, setDate] = useState(todayIso);
  const [startTime, setStartTime] = useState("");
  const [reason, setReason] = useState("");
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [bookedSlots, setBookedSlots] = useState<Set<string>>(new Set());
  const [hasWorkingDay, setHasWorkingDay] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ALL_TIME_SLOTS = [
    "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
    "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00",
    "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30",
    "19:00", "19:30", "20:00",
  ];

  const isToday = date === todayIso;
  const currentIst = istTime24();
  // Filter out any past time slots for today so they are never shown
  const visibleSlots = ALL_TIME_SLOTS.filter((s) => !isToday || s >= currentIst);

  useEffect(() => {
    if (!open) return;
    setError("");
    setLoadingDoctors(true);
    doctorApi.list(token, { active: true, all: true })
      .then((res) => {
        const payload = (res as unknown as { data: DoctorRow[] | Paginated<DoctorRow> }).data;
        const list = Array.isArray(payload) ? payload : (payload?.data ?? []);
        const active = list.filter((d) => d.is_active);
        setDoctors(active);
        if (active.length > 0 && doctorId === "") {
          setDoctorId(active[0].id);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load doctors."))
      .finally(() => setLoadingDoctors(false));
  }, [open, token]);

  useEffect(() => {
    // When date changes or slots load, select first unbooked available slot if needed
    if (visibleSlots.length > 0) {
      if (!startTime || (isToday && startTime < currentIst) || bookedSlots.has(startTime)) {
        const firstOpen = visibleSlots.find((s) => !bookedSlots.has(s));
        if (firstOpen) setStartTime(firstOpen);
        else if (startTime && (bookedSlots.has(startTime) || (isToday && startTime < currentIst))) setStartTime("");
      }
    } else {
      setStartTime("");
    }
  }, [date, isToday, currentIst, bookedSlots]);

  useEffect(() => {
    if (!doctorId || !date || !open) return;
    setLoadingAvailability(true);
    doctorApi.availability(token, doctorId, date)
      .then((res) => {
        const payload = (res as unknown as { data: { schedules?: { day_of_week: number; start_time: string; end_time: string }[]; appointments?: { start_time: string; status: string }[] } }).data;
        const booked = new Set((payload?.appointments || []).map((a) => String(a.start_time).slice(0, 5)));
        setBookedSlots(booked);
        const hasSched = (payload?.schedules || []).length > 0;
        setHasWorkingDay(hasSched);
        if (booked.has(startTime)) {
          const firstOpen = visibleSlots.find((s) => !booked.has(s));
          if (firstOpen) setStartTime(firstOpen);
        }
      })
      .catch(() => {
        setBookedSlots(new Set());
        setHasWorkingDay(null);
      })
      .finally(() => setLoadingAvailability(false));
  }, [doctorId, date, open, token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doctorId) {
      setError("Please select a doctor.");
      return;
    }
    if (!date) {
      setError("Please select an appointment date.");
      return;
    }
    if (isToday && startTime < currentIst) {
      setError(`Cannot book a slot for a past time. Current time is ${currentIst}. Please select an upcoming slot.`);
      return;
    }
    if (!startTime) {
      setError("Please select an appointment time slot.");
      return;
    }
    if (bookedSlots.has(startTime)) {
      setError("This time slot is already booked. Please choose another time.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await portalApi.bookAppointment(token, {
        doctor_id: Number(doctorId),
        appointment_date: date,
        start_time: startTime,
        reason_for_visit: reason.trim() || undefined,
      });
      onBooked();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not book appointment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} maxWidth="sm" fullWidth>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <DialogTitle sx={{ fontWeight: 700 }}>Book an appointment</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {hasWorkingDay === false && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              The selected doctor has no scheduled working blocks on this weekday. You may still request an appointment or pick another date.
            </Alert>
          )}
          {loadingDoctors && <CircularProgress size={24} sx={{ mb: 2, display: "block" }} />}

          <Stack spacing={2.5}>
            <FormControl fullWidth required size="small">
              <InputLabel id="doctor-select-label">Select doctor</InputLabel>
              <Select
                labelId="doctor-select-label"
                value={doctorId}
                label="Select doctor"
                onChange={(e) => setDoctorId(Number(e.target.value))}
                disabled={busy || loadingDoctors}
              >
                {doctors.map((d) => (
                  <MenuItem key={d.id} value={d.id}>
                    {d.display_name} {d.specialization ? `— ${d.specialization}` : ""}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              required
              fullWidth
              size="small"
              type="date"
              label="Appointment date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              slotProps={{ htmlInput: { min: todayIso } }}
              disabled={busy}
            />

            <Box>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                  {isToday ? `Available time slots for today (from ${currentIst} onwards)` : "Select preferred time slot"}
                </Typography>
                {loadingAvailability && <CircularProgress size={14} />}
              </Box>
              {visibleSlots.length === 0 ? (
                <Alert severity="info" sx={{ mt: 1 }}>
                  No more time slots available for today. Please select an upcoming date.
                </Alert>
              ) : (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  {visibleSlots.map((slot) => {
                    const selected = startTime === slot;
                    const isBooked = bookedSlots.has(slot);
                    return (
                      <Chip
                        key={slot}
                        label={isBooked ? `${slot} (Booked)` : slot}
                        clickable={!busy && !isBooked}
                        color={selected ? "primary" : isBooked ? "default" : "default"}
                        variant={selected ? "filled" : "outlined"}
                        disabled={isBooked}
                        onClick={() => !isBooked && setStartTime(slot)}
                        sx={{
                          fontWeight: selected ? 700 : 500,
                          opacity: isBooked ? 0.45 : 1,
                          textDecoration: isBooked ? "line-through" : "none",
                        }}
                      />
                    );
                  })}
                </Box>
              )}
            </Box>

            <TextField
              fullWidth
              multiline
              rows={2}
              size="small"
              label="Reason for visit / symptoms (optional)"
              placeholder="e.g. Regular check-up, cough and headache, follow-up..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy || !doctorId || bookedSlots.has(startTime)}>
            {busy ? "Booking..." : "Confirm booking"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function VisitsTab({
  token,
  onOpenPrescription,
}: {
  token: string;
  onOpenPrescription?: (rx: PrescriptionRow) => void;
}) {
  const { page, setPage, perPage, setPerPage, data, error } = usePaged<VisitRow>(
    async (p, n) => (await portalApi.visits(token, { page: p, per_page: n }) as unknown as { data: Paginated<VisitRow> }).data
  );
  const [selectedVisit, setSelectedVisit] = useState<VisitRow | null>(null);

  return (
    <Card><CardContent>
      <Box sx={{ mb: 2 }}>
        <Typography component="h2" variant="h6" fontWeight={700}>Your visits</Typography>
        <Typography variant="body2" color="text.secondary">History of consultation visits with clinical diagnosis, vitals, and doctor notes.</Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {!data && !error && <CircularProgress />}
      {data && data.data.length === 0 && <Typography color="text.secondary">No visits recorded yet.</Typography>}
      {data && data.data.length > 0 && (
        <Box className="desktop-data-table table-scroll" role="region" aria-label="Your visits" tabIndex={0}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Doctor</TableCell>
                <TableCell>Diagnosis</TableCell>
                <TableCell>Prescriptions</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>{String(v.visit_date).slice(0, 10)}</TableCell>
                  <TableCell>{v.doctor?.display_name ?? "—"}</TableCell>
                  <TableCell>{v.diagnosis ?? "—"}</TableCell>
                  <TableCell>
                    {(v.prescriptions ?? []).map((rx) => (
                      <Chip
                        key={rx.id}
                        size="small"
                        label={rx.prescription_number}
                        clickable={!!onOpenPrescription}
                        onClick={() => onOpenPrescription?.(rx)}
                        sx={{ mr: 0.5 }}
                      />
                    ))}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<IconEye size={14} />}
                      onClick={() => setSelectedVisit(v)}
                    >
                      View details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      {data && data.data.length > 0 && (
        <Box className="mobile-record-list" aria-label="Your visits">
          {data.data.map((v) => (
            <Box className="mobile-record-card" key={v.id}>
              <Box className="mobile-record-main">
                <Typography fontWeight={700}>{String(v.visit_date).slice(0, 10)}</Typography>
                <Chip size="small" label={v.status} color={v.status === "finalized" ? "success" : v.status === "amended" ? "info" : "warning"} />
              </Box>
              <Typography variant="body2">{v.doctor?.display_name ?? "Doctor"}</Typography>
              <Typography variant="body2" color="text.secondary">{v.diagnosis ?? "Diagnosis not recorded"}</Typography>
              {(v.prescriptions ?? []).length > 0 && (
                <Stack direction="row" flexWrap="wrap" spacing={0.5} sx={{ mt: 1 }}>
                  {(v.prescriptions ?? []).map((rx) => (
                    <Chip
                      key={rx.id}
                      size="small"
                      label={rx.prescription_number}
                      clickable={!!onOpenPrescription}
                      onClick={() => onOpenPrescription?.(rx)}
                    />
                  ))}
                </Stack>
              )}
              <Box sx={{ mt: 1.5, pt: 1, borderTop: "1px solid #edf2f0" }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<IconEye size={14} />}
                  onClick={() => setSelectedVisit(v)}
                >
                  View visit details
                </Button>
              </Box>
            </Box>
          ))}
        </Box>
      )}
      {data && <PagerBar page={data.current_page} lastPage={data.last_page} total={data.total} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />}

      <VisitDetailDialog
        visit={selectedVisit}
        token={token}
        onClose={() => setSelectedVisit(null)}
        onViewPrescription={(rx) => {
          setSelectedVisit(null);
          onOpenPrescription?.(rx);
        }}
      />
    </CardContent></Card>
  );
}

function VisitDetailDialog({
  visit,
  token,
  onClose,
  onViewPrescription,
}: {
  visit: VisitRow | null;
  token: string;
  onClose: () => void;
  onViewPrescription?: (rx: PrescriptionRow) => void;
}) {
  if (!visit) return null;
  const vitals = (visit.vitals as Record<string, string>) || {};
  const hasVitals = Object.values(vitals).some(Boolean);

  return (
    <Dialog open={!!visit} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Consultation Visit {visit.visit_number}</span>
        <Chip size="small" label={visit.status} color={visit.status === "finalized" ? "success" : visit.status === "amended" ? "info" : "warning"} />
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, bgcolor: "#f8faf9", p: 1.5, borderRadius: 1.5 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">Consulting doctor</Typography>
              <Typography variant="body2" fontWeight={600}>
                {visit.doctor?.display_name ?? "Doctor"} {visit.doctor?.specialization ? `(${visit.doctor.specialization})` : ""}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Visit date</Typography>
              <Typography variant="body2" fontWeight={600}>{String(visit.visit_date).slice(0, 10)}</Typography>
            </Box>
          </Box>

          {hasVitals && (
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", display: "block", mb: 1 }}>
                Recorded Vitals
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }, gap: 1.5 }}>
                <Box sx={{ p: 1, bgcolor: "#f8faf9", border: "1px solid #e7eeeb", borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">Blood Pressure</Typography>
                  <Typography variant="body2" fontWeight={700}>{vitals.bp || "—"}</Typography>
                </Box>
                <Box sx={{ p: 1, bgcolor: "#f8faf9", border: "1px solid #e7eeeb", borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">Pulse (bpm)</Typography>
                  <Typography variant="body2" fontWeight={700}>{vitals.pulse || "—"}</Typography>
                </Box>
                <Box sx={{ p: 1, bgcolor: "#f8faf9", border: "1px solid #e7eeeb", borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">Temperature</Typography>
                  <Typography variant="body2" fontWeight={700}>{vitals.temp ? `${vitals.temp} °C` : "—"}</Typography>
                </Box>
                <Box sx={{ p: 1, bgcolor: "#f8faf9", border: "1px solid #e7eeeb", borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">Weight</Typography>
                  <Typography variant="body2" fontWeight={700}>{vitals.weight ? `${vitals.weight} kg` : "—"}</Typography>
                </Box>
              </Box>
            </Box>
          )}

          {visit.symptoms && (
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", display: "block", mb: 0.5 }}>
                Presenting Symptoms
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{visit.symptoms}</Typography>
            </Box>
          )}

          {visit.examination_notes && (
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", display: "block", mb: 0.5 }}>
                Clinical Examination Notes
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{visit.examination_notes}</Typography>
            </Box>
          )}

          <Box sx={{ p: 1.5, bgcolor: "#f3f8f6", borderRadius: 1.5, borderLeft: "4px solid #0b6b68" }}>
            <Typography variant="caption" fontWeight={700} color="#0b6b68" display="block">Clinical Diagnosis</Typography>
            <Typography variant="body1" fontWeight={600} sx={{ mt: 0.25 }}>{visit.diagnosis || "No specific diagnosis recorded"}</Typography>
          </Box>

          {visit.treatment_plan && (
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", display: "block", mb: 0.5 }}>
                Doctor's Treatment Plan & Advice
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{visit.treatment_plan}</Typography>
            </Box>
          )}

          {visit.follow_up_date && (
            <Box sx={{ p: 1.5, bgcolor: "#f8faf9", borderRadius: 1.5, border: "1px solid #e7eeeb" }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", display: "block" }}>
                Recommended Follow-Up Date
              </Typography>
              <Typography variant="body2" fontWeight={700} color="primary.main">
                {String(visit.follow_up_date).slice(0, 10)}
              </Typography>
            </Box>
          )}

          {(visit.prescriptions ?? []).length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", display: "block", mb: 1 }}>
                Attached Prescriptions ({(visit.prescriptions ?? []).length})
              </Typography>
              <Stack spacing={1}>
                {(visit.prescriptions ?? []).map((rx) => (
                  <Box key={rx.id} sx={{ p: 1.5, bgcolor: "#f8faf9", borderRadius: 1.5, border: "1px solid #e7eeeb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Box>
                      <Typography variant="body2" fontWeight={700}>{rx.prescription_number}</Typography>
                      <Typography variant="caption" color="text.secondary">{(rx.items ?? []).length} medication(s)</Typography>
                    </Box>
                    {onViewPrescription && (
                      <Button size="small" variant="outlined" startIcon={<IconEye size={14} />} onClick={() => onViewPrescription(rx)}>
                        View prescription
                      </Button>
                    )}
                  </Box>
                ))}
              </Stack>
            </Box>
          )}

          {(visit.amendments ?? []).length > 0 && (
            <Box sx={{ p: 1.5, bgcolor: "#f8faf9", borderRadius: 1.5, border: "1px solid #e1e8e4" }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", display: "block", mb: 1 }}>
                Audited Clinical Amendments ({(visit.amendments ?? []).length})
              </Typography>
              <Stack spacing={1}>
                {(visit.amendments ?? []).map((am) => (
                  <Box key={am.id} sx={{ p: 1, bgcolor: "#fff", borderRadius: 1, border: "1px solid #e5ece8" }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                      <Chip size="small" label={am.reason} color="info" variant="outlined" />
                      <Typography variant="caption" color="text.secondary">{String(am.created_at).slice(0, 16).replace("T", " ")}</Typography>
                    </Box>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{am.notes}</Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function PrescriptionsTab({ token, initialPrescription }: { token: string; initialPrescription?: PrescriptionRow | null }) {
  const { page, setPage, perPage, setPerPage, data, error } = usePaged<PrescriptionRow>(
    async (p, n) => (await portalApi.prescriptions(token, { page: p, per_page: n }) as unknown as { data: Paginated<PrescriptionRow> }).data
  );
  const [selected, setSelected] = useState<PrescriptionRow | null>(initialPrescription ?? null);
  const [printError, setPrintError] = useState("");

  useEffect(() => {
    if (initialPrescription) setSelected(initialPrescription);
  }, [initialPrescription]);

  const printPrescription = async (rx: PrescriptionRow) => {
    const printWindow = window.open("about:blank", "_blank");
    if (!printWindow) {
      setPrintError("Allow pop-ups to print your prescription.");
      return;
    }
    try {
      const res = await portalApi.printPrescription(token, rx.id);
      const payload = (res as unknown as { data: { prescription: PrescriptionRow; clinic: { clinic_name?: string; address?: string; phone?: string; prescription_footer?: string; logo_data_uri?: string | null } | null } }).data;
      const dataRx = payload.prescription;
      const logo = (payload.clinic?.logo_data_uri ?? "").startsWith("data:image/") ? payload.clinic!.logo_data_uri! : "";
      const medicineRows = (dataRx.items ?? []).map((m) =>
        `<tr><td><strong>${escapeHtml(m.medicine_name)}</strong> ${escapeHtml(m.strength || "")}</td><td>${escapeHtml(m.dosage)}</td><td>${escapeHtml(m.route || "oral")}</td><td>${escapeHtml(m.frequency)}</td><td>${escapeHtml(m.duration)}</td><td>${escapeHtml(m.instructions || "—")}</td></tr>`
      ).join("");
      const header = `<div class="head">${logo ? `<img class="logo" src="${logo}" alt="">` : ""}<div><h1>${escapeHtml(payload.clinic?.clinic_name || "Clinic")}</h1><p>${escapeHtml(payload.clinic?.address || "")}</p><p>${escapeHtml(payload.clinic?.phone || "")}</p></div></div>`;
      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Prescription ${escapeHtml(dataRx.prescription_number)}</title><style>body{font:14px Arial,sans-serif;color:#19302f;max-width:780px;margin:36px auto;padding:0 24px}h1{font:26px Georgia,serif;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:8px 10px;border-bottom:1px solid #dfeae5;text-align:left;vertical-align:top}th{background:#f3f7f5;font-weight:600}footer{margin-top:36px;color:#637372;font-size:12px;border-top:1px solid #dfeae5;padding-top:12px}.head{display:flex;gap:16px;align-items:center;margin-bottom:12px}.head p{margin:2px 0;font-size:13px}.logo{width:64px;height:64px;object-fit:contain}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0;background:#f9fbfa;padding:12px;border-radius:4px}</style></head><body>${header}<hr><h2>Prescription ${escapeHtml(dataRx.prescription_number)}</h2><div class="meta"><div><strong>Doctor:</strong> ${escapeHtml(dataRx.doctor?.display_name || "Doctor")}<br><strong>Date:</strong> ${escapeHtml(String(dataRx.issued_at ?? "").slice(0, 10) || "—")}</div><div><strong>Status:</strong> ${escapeHtml(dataRx.status)}</div></div><table><thead><tr><th>Medicine</th><th>Dosage</th><th>Route</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>${medicineRows || "<tr><td colspan='6'>No medications listed</td></tr>"}</tbody></table>${dataRx.instructions ? `<p><strong>Doctor's Advice:</strong><br>${escapeHtml(dataRx.instructions)}</p>` : ""}<footer>${escapeHtml(payload.clinic?.prescription_footer || "Dedicated to your well-being.")}</footer></body></html>`);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } catch (e: unknown) {
      printWindow.close();
      setPrintError(e instanceof Error ? e.message : "Could not print prescription.");
    }
  };

  return (
    <Card><CardContent>
      <Box sx={{ mb: 2 }}>
        <Typography component="h2" variant="h6" fontWeight={700}>Your prescriptions</Typography>
        <Typography variant="body2" color="text.secondary">Review doctor medications, dosage instructions, and print prescription copies.</Typography>
      </Box>

      {printError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPrintError("")}>{printError}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {!data && !error && <CircularProgress />}
      {data && data.data.length === 0 && <Typography color="text.secondary">No prescriptions issued yet.</Typography>}

      {data && data.data.length > 0 && (
        <Box className="desktop-data-table table-scroll" role="region" aria-label="Your prescriptions" tabIndex={0}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Prescription</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Doctor</TableCell>
                <TableCell>Medicines</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((rx) => (
                <TableRow key={rx.id}>
                  <TableCell className="mono" sx={{ fontWeight: 600 }}>{rx.prescription_number}</TableCell>
                  <TableCell>{String(rx.issued_at ?? "").slice(0, 10) || "—"}</TableCell>
                  <TableCell>{rx.doctor?.display_name ?? "—"}</TableCell>
                  <TableCell>
                    {(rx.items ?? []).length > 0 ? (
                      <Stack direction="row" flexWrap="wrap" spacing={0.5}>
                        {(rx.items ?? []).map((it) => (
                          <Chip key={it.id} size="small" variant="outlined" label={`${it.medicine_name} ${it.strength || ""}`.trim()} />
                        ))}
                      </Stack>
                    ) : "No medicines"}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={rx.status}
                      color={rx.status === "finalized" ? "success" : "default"}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<IconEye size={14} />}
                        onClick={() => setSelected(rx)}
                      >
                        View
                      </Button>
                      {rx.status === "finalized" && (
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<IconPrinter size={14} />}
                          onClick={() => void printPrescription(rx)}
                        >
                          Print
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {data && data.data.length > 0 && (
        <Box className="mobile-record-list" aria-label="Your prescriptions">
          {data.data.map((rx) => (
            <Box className="mobile-record-card" key={rx.id}>
              <Box className="mobile-record-main">
                <Box>
                  <Typography className="mono" fontWeight={700}>{rx.prescription_number}</Typography>
                  <Typography variant="caption" color="text.secondary">{String(rx.issued_at ?? "").slice(0, 10) || "Draft"}</Typography>
                </Box>
                <Chip size="small" label={rx.status} color={rx.status === "finalized" ? "success" : "default"} />
              </Box>
              <Typography variant="body2" fontWeight={600}>{rx.doctor?.display_name ?? "Doctor"}</Typography>
              <Typography variant="body2" color="text.secondary">{(rx.items ?? []).length} medication(s) prescribed</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1.5, pt: 1, borderTop: "1px solid #edf2f0" }}>
                <Button size="small" variant="outlined" startIcon={<IconEye size={14} />} onClick={() => setSelected(rx)}>
                  View details
                </Button>
                {rx.status === "finalized" && (
                  <Button size="small" variant="text" startIcon={<IconPrinter size={14} />} onClick={() => void printPrescription(rx)}>
                    Print
                  </Button>
                )}
              </Stack>
            </Box>
          ))}
        </Box>
      )}

      {data && <PagerBar page={data.current_page} lastPage={data.last_page} total={data.total} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />}

      {/* Prescription Detail Dialog */}
      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Prescription {selected?.prescription_number}</span>
          {selected?.status && (
            <Chip size="small" label={selected.status} color={selected.status === "finalized" ? "success" : "default"} />
          )}
        </DialogTitle>
        <DialogContent dividers>
          {selected && (
            <Stack spacing={2}>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, bgcolor: "#f8faf9", p: 1.5, borderRadius: 1.5 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Prescribing doctor</Typography>
                  <Typography variant="body2" fontWeight={600}>{selected.doctor?.display_name ?? "—"}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Issued date</Typography>
                  <Typography variant="body2" fontWeight={600}>{String(selected.issued_at ?? "").slice(0, 10) || "—"}</Typography>
                </Box>
              </Box>

              <Typography variant="subtitle2" fontWeight={700}>Prescribed medications</Typography>
              <Box className="desktop-data-table table-scroll" tabIndex={0}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Medicine</TableCell>
                      <TableCell>Dosage</TableCell>
                      <TableCell>Route</TableCell>
                      <TableCell>Frequency</TableCell>
                      <TableCell>Duration</TableCell>
                      <TableCell>Instructions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(selected.items ?? []).map((it) => (
                      <TableRow key={it.id}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>{it.medicine_name}</Typography>
                          {it.strength && <Typography variant="caption" color="text.secondary">{it.strength}</Typography>}
                        </TableCell>
                        <TableCell>{it.dosage}</TableCell>
                        <TableCell>{it.route || "oral"}</TableCell>
                        <TableCell>{it.frequency}</TableCell>
                        <TableCell>{it.duration}</TableCell>
                        <TableCell>{it.instructions || "—"}</TableCell>
                      </TableRow>
                    ))}
                    {(selected.items ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={6} align="center"><Typography color="text.secondary" sx={{ py: 1 }}>No medicines listed</Typography></TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>

              {selected.instructions && (
                <Box sx={{ mt: 1, p: 1.5, bgcolor: "#f3f8f6", borderRadius: 1.5, borderLeft: "4px solid #0b6b68" }}>
                  <Typography variant="caption" fontWeight={700} color="#0b6b68" display="block">Doctor's advice & instructions</Typography>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>{selected.instructions}</Typography>
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, justifyContent: "space-between" }}>
          {selected?.status === "finalized" ? (
            <Button startIcon={<IconPrinter size={16} />} onClick={() => { if (selected) void printPrescription(selected); }}>
              Print prescription
            </Button>
          ) : <Box />}
          <Button onClick={() => setSelected(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </CardContent></Card>
  );
}

function InvoicesTab({ token }: { token: string }) {
  const { page, setPage, perPage, setPerPage, data, error } = usePaged<InvoiceRow>(
    async (p, n) => (await portalApi.invoices(token, { page: p, per_page: n }) as unknown as { data: Paginated<InvoiceRow> }).data
  );
  const [selected, setSelected] = useState<InvoiceRow | null>(null);
  const [printError, setPrintError] = useState("");

  const printReceipt = async (inv: InvoiceRow) => {
    const printWindow = window.open("about:blank", "_blank");
    if (!printWindow) {
      setPrintError("Allow pop-ups to print the receipt.");
      return;
    }
    try {
      const res = await portalApi.printInvoice(token, inv.id);
      const payload = (res as unknown as { data: { invoice: InvoiceRow; clinic: { clinic_name?: string; address?: string; phone?: string; logo_data_uri?: string | null } | null } }).data;
      const invoice = payload.invoice;
      const logo = (payload.clinic?.logo_data_uri ?? "").startsWith("data:image/") ? payload.clinic!.logo_data_uri! : "";
      const header = `<div class="head">${logo ? `<img class="logo" src="${logo}" alt="">` : ""}<div><h1>${escapeHtml(payload.clinic?.clinic_name || "Clinic")}</h1><p>${escapeHtml(payload.clinic?.address || "")}</p><p>${escapeHtml(payload.clinic?.phone || "")}</p></div></div>`;
      const items = (invoice.items ?? []).map((it) =>
        `<tr><td>${escapeHtml(it.description)}</td><td>${Number(it.quantity)}</td><td>${money(it.unit_price)}</td><td>${money(it.line_total)}</td></tr>`
      ).join("");
      const payments = (invoice.payments ?? []).map((p) =>
        `<tr><td>${escapeHtml(p.payment_number)}</td><td>${escapeHtml(p.paid_at.slice(0, 10))}</td><td>${escapeHtml(p.payment_method)}</td><td>${money(p.amount)}</td></tr>`
      ).join("");

      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(invoice.invoice_number)}</title><style>body{font:14px Arial,sans-serif;color:#19302f;max-width:760px;margin:40px auto;padding:0 24px}h1{font:26px Georgia,serif;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:8px 10px;border-bottom:1px solid #dfeae5;text-align:left}td:nth-child(n+2),th:nth-child(n+2){text-align:right}th{background:#f3f7f5}.total-row{font-size:16px;font-weight:bold}.head{display:flex;gap:18px;align-items:center;margin-bottom:6px}.head div{margin:2px 0}.logo{width:64px;height:64px;object-fit:contain}@media print{body{margin:0 auto}}</style></head><body>${header}<hr><h2>Payment receipt: ${escapeHtml(invoice.invoice_number)}</h2><p>Date: ${escapeHtml(invoice.invoice_date)}</p><table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${items || "<tr><td colspan='4'>No items</td></tr>"}</tbody></table><div style="margin-left:auto;width:280px;text-align:right"><p>Subtotal: ${money(invoice.subtotal)}</p><p>Discount: ${money(invoice.discount_amount)}</p><p class="total-row">Total: ${money(invoice.total_amount)}</p><p>Amount paid: ${money(invoice.paid_amount ?? 0)}</p><p><strong>Outstanding balance: ${money(invoice.balance ?? 0)}</strong></p></div>${payments ? `<h3>Payments recorded</h3><table><thead><tr><th>Payment #</th><th>Date</th><th>Method</th><th>Amount</th></tr></thead><tbody>${payments}</tbody></table>` : ""}</body></html>`);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } catch (e: unknown) {
      printWindow.close();
      setPrintError(e instanceof Error ? e.message : "Could not prepare receipt printout.");
    }
  };

  const totalBilled = (data?.data ?? []).reduce((acc, row) => acc + Number(row.total_amount || 0), 0);
  const totalPaid = (data?.data ?? []).reduce((acc, row) => acc + Number(row.paid_amount || 0), 0);
  const totalBalance = (data?.data ?? []).reduce((acc, row) => acc + Number(row.balance ?? (Number(row.total_amount || 0) - Number(row.paid_amount || 0))), 0);

  return (
    <Card><CardContent>
      <Box sx={{ mb: 2 }}>
        <Typography component="h2" variant="h6" fontWeight={700}>Your bills & payments</Typography>
        <Typography variant="body2" color="text.secondary">Review all clinic charges, payment records, and download receipts.</Typography>
      </Box>

      {/* Quick summary stats */}
      {data && data.data.length > 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 1.5, mb: 2.5 }}>
          <Box sx={{ p: 1.5, bgcolor: "#fff", border: "1px solid #e7eeeb", borderRadius: 1.5 }}>
            <Typography variant="caption" color="text.secondary">Total billed</Typography>
            <Typography variant="h6" fontWeight={700} color="#19302f">{money(totalBilled)}</Typography>
          </Box>
          <Box sx={{ p: 1.5, bgcolor: "#fff", border: "1px solid #e7eeeb", borderRadius: 1.5 }}>
            <Typography variant="caption" color="text.secondary">Total paid</Typography>
            <Typography variant="h6" fontWeight={700} color="#2e7d32">{money(totalPaid)}</Typography>
          </Box>
          <Box sx={{ p: 1.5, bgcolor: "#fff", border: "1px solid #e7eeeb", borderRadius: 1.5 }}>
            <Typography variant="caption" color="text.secondary">Outstanding balance</Typography>
            <Typography variant="h6" fontWeight={700} color={totalBalance > 0 ? "#c62828" : "#2e7d32"}>{money(totalBalance)}</Typography>
          </Box>
        </Box>
      )}

      {printError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPrintError("")}>{printError}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {!data && !error && <CircularProgress />}
      {data && data.data.length === 0 && <Typography color="text.secondary">No bills recorded yet.</Typography>}

      {data && data.data.length > 0 && (
        <Box className="desktop-data-table table-scroll" role="region" aria-label="Your bills" tabIndex={0}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Invoice</TableCell>
                <TableCell>Date</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="right">Paid</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="mono" sx={{ fontWeight: 600 }}>{i.invoice_number}</TableCell>
                  <TableCell>{String(i.invoice_date).slice(0, 10)}</TableCell>
                  <TableCell align="right">{money(i.total_amount)}</TableCell>
                  <TableCell align="right">{money(i.paid_amount ?? 0)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: Number(i.balance ?? 0) > 0 ? 700 : 400 }}>
                    {money(i.balance ?? i.total_amount)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={i.status === "paid" ? "success" : i.status === "partially_paid" ? "warning" : "default"}
                      label={String(i.status).replace(/_/g, " ")}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<IconEye size={14} />}
                        onClick={() => setSelected(i)}
                      >
                        Details
                      </Button>
                      <Button
                        size="small"
                        variant="text"
                        startIcon={<IconPrinter size={14} />}
                        onClick={() => void printReceipt(i)}
                      >
                        Receipt
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {data && data.data.length > 0 && (
        <Box className="mobile-record-list" aria-label="Your bills">
          {data.data.map((i) => (
            <Box className="mobile-record-card" key={i.id}>
              <Box className="mobile-record-main">
                <Box>
                  <Typography className="mono" fontWeight={700}>{i.invoice_number}</Typography>
                  <Typography variant="caption" color="text.secondary">{String(i.invoice_date).slice(0, 10)}</Typography>
                </Box>
                <Chip
                  size="small"
                  color={i.status === "paid" ? "success" : i.status === "partially_paid" ? "warning" : "default"}
                  label={String(i.status).replace(/_/g, " ")}
                />
              </Box>
              <Box className="mobile-record-meta">
                <span>Total</span><Typography fontWeight={700}>{money(i.total_amount)}</Typography>
                <span>Paid</span><Typography>{money(i.paid_amount ?? 0)}</Typography>
                <span>Balance</span><Typography fontWeight={600} color={Number(i.balance ?? 0) > 0 ? "error.main" : "text.primary"}>{money(i.balance ?? i.total_amount)}</Typography>
              </Box>
              <Stack direction="row" spacing={1} sx={{ mt: 1.5, pt: 1, borderTop: "1px solid #edf2f0" }}>
                <Button size="small" variant="outlined" startIcon={<IconEye size={14} />} onClick={() => setSelected(i)}>
                  View details
                </Button>
                <Button size="small" variant="text" startIcon={<IconPrinter size={14} />} onClick={() => void printReceipt(i)}>
                  Print receipt
                </Button>
              </Stack>
            </Box>
          ))}
        </Box>
      )}

      {data && <PagerBar page={data.current_page} lastPage={data.last_page} total={data.total} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />}

      {/* Invoice Detail Dialog */}
      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Invoice {selected?.invoice_number}</span>
          {selected?.status && (
            <Chip size="small" label={selected.status.replace(/_/g, " ")} color={selected.status === "paid" ? "success" : "warning"} />
          )}
        </DialogTitle>
        <DialogContent dividers>
          {selected && (
            <Stack spacing={2}>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, bgcolor: "#f8faf9", p: 1.5, borderRadius: 1.5 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Invoice date</Typography>
                  <Typography variant="body2" fontWeight={600}>{String(selected.invoice_date).slice(0, 10)}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Total amount</Typography>
                  <Typography variant="body2" fontWeight={700}>{money(selected.total_amount)}</Typography>
                </Box>
              </Box>

              <Typography variant="subtitle2" fontWeight={700}>Billed items</Typography>
              <Box className="desktop-data-table table-scroll" tabIndex={0}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Description</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell align="right">Unit price</TableCell>
                      <TableCell align="right">Total</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(selected.items ?? []).map((it) => (
                      <TableRow key={it.id}>
                        <TableCell>{it.description}</TableCell>
                        <TableCell align="right">{Number(it.quantity)}</TableCell>
                        <TableCell align="right">{money(it.unit_price)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{money(it.line_total)}</TableCell>
                      </TableRow>
                    ))}
                    {(selected.items ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={4} align="center"><Typography color="text.secondary" sx={{ py: 1 }}>Consultation charge</Typography></TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>

              <Box sx={{ p: 1.5, bgcolor: "#f9fbfa", borderRadius: 1.5, border: "1px solid #edf2f0" }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">Subtotal</Typography>
                  <Typography variant="body2">{money(selected.subtotal)}</Typography>
                </Box>
                {Number(selected.discount_amount) > 0 && (
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">Discount</Typography>
                    <Typography variant="body2" color="success.main">-{money(selected.discount_amount)}</Typography>
                  </Box>
                )}
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                  <Typography variant="body2" fontWeight={700}>Invoice total</Typography>
                  <Typography variant="body2" fontWeight={700}>{money(selected.total_amount)}</Typography>
                </Box>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">Amount paid</Typography>
                  <Typography variant="body2" color="success.main" fontWeight={600}>{money(selected.paid_amount ?? 0)}</Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" fontWeight={700} color={Number(selected.balance ?? 0) > 0 ? "error.main" : "text.primary"}>Balance due</Typography>
                  <Typography variant="body2" fontWeight={700} color={Number(selected.balance ?? 0) > 0 ? "error.main" : "text.primary"}>
                    {money(selected.balance ?? selected.total_amount)}
                  </Typography>
                </Box>
              </Box>

              {(selected.payments ?? []).length > 0 && (
                <Box>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Payments received</Typography>
                  <Stack spacing={1}>
                    {(selected.payments ?? []).map((p) => (
                      <Box key={p.id} sx={{ p: 1, bgcolor: "#f3f8f6", borderRadius: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <Box>
                          <Typography variant="body2" fontWeight={600}>{p.payment_number} ({p.payment_method})</Typography>
                          <Typography variant="caption" color="text.secondary">{String(p.paid_at).slice(0, 10)}</Typography>
                        </Box>
                        <Typography variant="body2" fontWeight={700} color="#2e7d32">{money(p.amount)}</Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, justifyContent: "space-between" }}>
          <Button startIcon={<IconPrinter size={16} />} onClick={() => { if (selected) void printReceipt(selected); }}>
            Print receipt
          </Button>
          <Button onClick={() => setSelected(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </CardContent></Card>
  );
}
