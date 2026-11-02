import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveRefresh } from "./lib/realtime";
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  AppBar,
  Autocomplete,
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
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tab,
  TextField,
  Toolbar,
  Tabs,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import {
  IconActivity,
  IconCalendarEvent,
  IconCash,
  IconChevronRight,
  IconClipboardHeart,
  IconClock,
  IconDashboard,
  IconFileAnalytics,
  IconNotes,
  IconPill,
  IconPhoto,
  IconSettings,
  IconUsers,
  IconX,
  IconLogout,
  IconEdit,
  IconHistory,
  IconCalendarPlus,
  IconDownload,
  IconShieldCheck,
  IconPrinter,
  IconReceipt,
} from "@tabler/icons-react";
import { useAuth } from "./AuthContext";
import { AuthGate } from "./components/auth";
import { Sidebar, type NavEntry } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { MyProfileDialog } from "./components/MyProfileDialog";
import { CLINIC_LOGO_EVENT, useClinicLogo } from "./lib/clinicLogo";
import { getClinicDetails, setClinicDetails } from "./lib/clinicStore";
import { generalMessage } from "./lib/whatsapp";
import { WhatsAppButton } from "./components/WhatsAppButton";
import { StatCard, type StatCardProps } from "./components/StatCard";
import { WhatsAppSettings } from "./components/WhatsAppSettings";
import { ActivityLogPanel } from "./components/ActivityLogPanel";
import { ThemeEditor } from "./components/ThemeEditor";
import { AIAssistant } from "./components/AIAssistant";
import { AiConsultAssist } from "./components/AiConsultAssist";
import { AiPatientSummary } from "./components/AiPatientSummary";
import { AISettings } from "./components/AISettings";
import { useAiStatus } from "./lib/ai";
import { istCompactDate, istDate, istDateTime, istLongDate, istMonthStart } from "./lib/ist";
import { ClinicHoursEditor, readClinicHours, type ClinicHours } from "./components/ClinicHours";
import { FilterSelect, PagerBar, PersonAvatar, useDebounced } from "./components/common";
import { PatientsPage } from "./pages/PatientsPage";
import { PatientPortal } from "./pages/PatientPortal";
import { StaffPage } from "./pages/StaffPage";
import { PhotosPage } from "./pages/PhotosPage";
import { AppointmentsPage } from "./pages/AppointmentsPage";
import { BillingPage, InvoiceCreate, printReceiptDoc } from "./pages/BillingPage";
import { PrescriptionsPage, PrescriptionForm, printPrescriptionDoc } from "./pages/PrescriptionsPage";
import {
  appointmentApi,
  auditApi,
  clinicApi,
  dashboardApi,
  doctorApi,
  patientApi,
  prescriptionApi,
  reportApi,
  visitApi,
  type AppointmentRow,
  type AuditRow,
  type AiConsultDraft,
  type AiStatus,
  type ClinicSettingRow,
  type DashboardSummary,
  type DoctorRow,
  type InvoiceRow,
  type PatientRow,
  type Paginated,
  type PrescriptionRow,
  type VisitRow,
  type UserRole,
} from "./api";
import type { Page } from "./navigation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const nav: NavEntry[] = [
  { label: "Dashboard", icon: <IconDashboard /> },
  { label: "Patients", icon: <IconUsers /> },
  { label: "Appointments", icon: <IconCalendarEvent /> },
  { label: "Consultation", icon: <IconClipboardHeart /> },
  { label: "Prescriptions", icon: <IconPill /> },
  { label: "Billing", icon: <IconCash /> },
  { label: "Reports", icon: <IconFileAnalytics /> },
  { label: "Staff", icon: <IconUsers /> },
  { label: "Photos", icon: <IconPhoto /> },
  { label: "Settings", icon: <IconSettings /> },
];
const rolePages: Record<UserRole, Page[]> = {
  admin: nav.map((item) => item.label),
  doctor: ["Dashboard", "Patients", "Appointments", "Consultation", "Prescriptions", "Photos"],
  receptionist: ["Dashboard", "Patients", "Appointments", "Billing", "Photos"],
  patient: [],
};
const navForRole = (role: UserRole) => nav.filter((item) => rolePages[role].includes(item.label));
function fmtMoney(v: string | number): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? `₹ ${n.toLocaleString("en-IN")}` : String(v);
}
function patientDisplay(p: PatientRow): string {
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.patient_number;
}
function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}
function apptStatusColor(s: string): "success" | "warning" | "error" | "info" | "default" {
  if (s === "completed") return "success";
  if (s === "cancelled" || s === "no_show") return "error";
  if (s === "in_consultation") return "info";
  if (s === "waiting" || s === "booked") return "warning";
  return "default";
}
function unwrap<T>(res: { data: T }): T { return (res as unknown as { data: T }).data; }
/** Rows from a paginated envelope: { data: { data: T[], ... } } */
function pagedRows<T>(res: unknown): T[] {
  const env = (res as { data?: { data?: unknown } })?.data;
  return Array.isArray(env?.data) ? (env!.data as T[]) : [];
}
/** Rows from a plain list envelope: { data: T[] } */
function listRows<T>(res: unknown): T[] {
  const d = (res as { data?: unknown })?.data;
  return Array.isArray(d) ? (d as T[]) : [];
}
function unwrapList<T>(res: { data: T[] | { data: T[] } } | { data: T[] }): T[] {
  const d = (res as unknown as { data: unknown }).data as unknown;
  if (Array.isArray(d)) return d as T[];
  if (d && typeof d === "object" && Array.isArray((d as { data: unknown }).data)) return (d as { data: T[] }).data;
  return [];
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
export default function App() {
  const auth = useAuth();
  if (!auth.token || !auth.user) return <AuthGate />;
  // Patients get their own self-service portal; staff get the workspace.
  if (auth.user.role === "patient") return <PatientPortal />;
  return <AuthedApp />;
}

function AuthedApp() {
  const auth = useAuth();
  const token = auth.token!;
  const user = auth.user!;
  const navItems = useMemo(() => navForRole(user.role), [user.role]);
  const [page, setPage] = useState<Page>("Dashboard");
  const [moreOpen, setMoreOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width:767px)");
  const [toast, setToast] = useState("");
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [appts, setAppts] = useState<AppointmentRow[]>([]);
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailPatient, setDetailPatient] = useState<PatientRow | null>(null);
  const [appointmentDialog, setAppointmentDialog] = useState<AppointmentRow | "walk-in" | "appointment" | null>(null);
  const [appointmentEdit, setAppointmentEdit] = useState<AppointmentRow | null>(null);
  const [appointmentListVersion, setAppointmentListVersion] = useState(0);
  const [dash, setDash] = useState<DashboardSummary | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [consultTarget, setConsultTarget] = useState<{ patientId?: number; appointmentId?: number } | null>(null);
  // Clinic hours and timezone drive the sidebar status. Loaded for every role (public clinic info).
  const [clinicInfo, setClinicInfo] = useState<{ name: string; hours: ClinicHours | null; address?: string | null; phone?: string | null; hasLogo?: boolean }>({ name: "", hours: null });
  // The clinic logo is shown in the app chrome and refreshed when it changes.
  const clinicLogo = useClinicLogo(token, clinicInfo.hasLogo === true);
  // AI status shared by the assistant dialog, the draft panels and Settings.
  const { ai, reload: reloadAi } = useAiStatus(token);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const loadClinic = useCallback(() => {
    clinicApi.status(token).then((r) => {
      const c = unwrap<Pick<ClinicSettingRow, "clinic_name" | "address" | "phone" | "working_hours"> & { timezone: string; has_logo?: boolean; country_code?: string }>(r as unknown as { data: Pick<ClinicSettingRow, "clinic_name" | "address" | "phone" | "working_hours"> & { timezone: string; has_logo?: boolean; country_code?: string } });
      setClinicInfo({
        name: c.clinic_name ?? "",
        address: c.address ?? null,
        phone: c.phone ?? null,
        hasLogo: c.has_logo === true,
        hours: readClinicHours(c.working_hours),
      });
      setClinicDetails({ name: c.clinic_name ?? "", countryCode: c.country_code ?? "91" });
    }).catch(() => {});
  }, [token]);
  useEffect(() => { loadClinic(); }, [loadClinic]);
  useLiveRefresh(loadClinic);
  useEffect(() => {
    if (!rolePages[user.role].includes(page)) setPage("Dashboard");
  }, [page, user.role]);

  const fetchAll = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const [pRes, aRes, dRes, dashRes] = await Promise.all([
        patientApi.list(token, { per_page: 100 }),
        appointmentApi.list(token, { per_page: 100 }),
        doctorApi.list(token, { all: true }),
        dashboardApi.summary(token).catch(() => null),
      ]);
      setPatients(pagedRows<PatientRow>(pRes));
      setAppts(pagedRows<AppointmentRow>(aRes));
      setDoctors(listRows<DoctorRow>(dRes));
      if (dashRes) setDash(unwrap<DashboardSummary>(dashRes as unknown as { data: DashboardSummary }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load data";
      setToast(msg);
    } finally { if (!background) setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useLiveRefresh(() => fetchAll(true));
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 2600); return () => clearTimeout(t); } }, [toast]);

  const patientById = useCallback((id: number) => {
    const p = patients.find((x) => x.id === id);
    return p ? patientDisplay(p) : `#${id}`;
  }, [patients]);

  const refreshAppts = useCallback(async () => {
    const r = await appointmentApi.list(token, { per_page: 100 });
    setAppts(pagedRows<AppointmentRow>(r));
    setAppointmentListVersion((v) => v + 1);
  }, [token]);

  return (
    <Box className="app-frame">
      <Box className="desktop-sidebar"><Sidebar page={page} navItems={navItems} appointmentCount={dash?.appointments_today ?? appts.filter((a) => a.status !== "cancelled").length} setPage={setPage} clinic={clinicInfo} logoUrl={clinicLogo} /></Box>
      <Box className="main-column">
        <TopBar
          user={user}
          clinic={clinicInfo}
          page={page}
          setPage={setPage}
          waitingCount={dash?.waiting_queue ?? 0}
          todayApptsCount={dash?.appointments_today ?? appts.filter((a) => a.status !== "cancelled").length}
          token={token}
          onQuickBook={() => setAppointmentDialog("appointment")}
          onQuickWalkIn={() => setAppointmentDialog("walk-in")}
          onLogout={() => auth.logout()}
          onEditProfile={() => setProfileOpen(true)}
          logoUrl={clinicLogo}
          patients={patients}
          appts={appts}
          onSelectPatient={(p) => setDetailPatient(p)}
          aiReady={ai?.configured === true && ai.features.assistant === true}
          onOpenAssistant={() => setAssistantOpen(true)}
        />
        <Box component="main" className="content">
          <Box className={`page-heading${page === "Dashboard" ? " has-primary" : ""}`}>
            <Typography className="page-title" variant="h3" component="h1">{page === "Dashboard" ? "Clinic dashboard" : page}</Typography>
            <Typography className="page-support" color="text.secondary">
                {page === "Dashboard" ? "Today at your clinic."
                  : page === "Patients" ? user.role === "doctor" ? "Find patient records and your visit history." : "Find and manage patient records."
                  : page === "Appointments" ? user.role === "doctor" ? "Review assigned visits and update their status." : "Schedule visits and manage check-in."
                  : page === "Consultation" ? "Record the visit and treatment plan."
                  : page === "Billing" ? "Collections and outstanding balances."
                  : page === "Reports" ? "Collections and activity for the selected dates."
                  : page === "Settings" ? "Clinic details, opening hours, AI setup, and audit activity."
                  : page === "Staff" ? "Manage staff accounts and doctor schedules."
                  : page === "Photos" ? "View, replace or remove staff and patient photos."
                  : "Browse and manage treatment plans."}
            </Typography>
            {page === "Dashboard" && <Button variant="contained" startIcon={user.role === "doctor" ? <IconClipboardHeart size={18} /> : <IconCalendarEvent size={18} />} onClick={() => user.role === "doctor" ? setPage("Consultation") : setAppointmentDialog("appointment")}>{user.role === "doctor" ? "Start consultation" : "Book appointment"}</Button>}
          </Box>
          {loading && <Box sx={{ display: "grid", placeItems: "center", py: 6 }}><CircularProgress /></Box>}
          {!loading && page === "Dashboard" && <DashboardFull role={user.role} dash={dash} appts={appts} doctors={doctors} patientById={patientById} go={setPage} />}
          {page === "Patients" && <PatientsPage token={token} role={user.role} isAdmin={user.role === "admin"} onDetail={setDetailPatient} />}
          {page === "Staff" && (user.role === "admin" ? <StaffPage token={token} selfId={user.id} /> : <Alert severity="warning">Administrator access required.</Alert>)}
          {page === "Photos" && (user.role === "patient" ? <Alert severity="warning">Staff access required.</Alert> : <PhotosPage token={token} role={user.role} toast={setToast} />)}
          {!loading && page === "Appointments" && (
            <AppointmentsPage
              token={token}
              role={user.role}
              doctors={doctors}
              refreshKey={appointmentListVersion}
              onBook={() => setAppointmentDialog("appointment")}
              onWalkIn={() => setAppointmentDialog("walk-in")}
              onEdit={setAppointmentEdit}
              onChanged={() => void refreshAppts()}
              onConsult={(a) => {
                setConsultTarget({ patientId: a.patient_id, appointmentId: a.id });
                setPage("Consultation");
              }}
            />
          )}
          {!loading && page === "Consultation" && (
            <ConsultationReal
              role={user.role}
              currentUserId={user.id}
              patients={patients}
              doctors={doctors}
              token={token}
              toast={setToast}
              ai={ai}
              target={consultTarget}
              onClearTarget={() => setConsultTarget(null)}
            />
          )}
          {!loading && page === "Prescriptions" && <PrescriptionsPage token={token} ai={ai} />}
          {!loading && page === "Billing" && <BillingPage token={token} role={user.role} />}
          {!loading && page === "Reports" && <ReportsReal token={token} />}
          {!loading && page === "Settings" && <SettingsReal token={token} toast={setToast} onClinicChanged={loadClinic} onStaff={() => setPage("Staff")} onAiChanged={reloadAi} />}
        </Box>
      </Box>
      {toast && <Box className="toast" onClick={() => setToast("")} role="status">{toast} <IconX size={16} /></Box>}
      {detailPatient && (
        <PatientDetailReal
          token={token}
          role={user.role}
          patient={detailPatient}
          onClose={() => setDetailPatient(null)}
          onBook={() => { setDetailPatient(null); setPage("Appointments"); setAppointmentDialog("appointment"); }}
          onConsult={(p) => {
            setDetailPatient(null);
            setConsultTarget({ patientId: p.id });
            setPage("Consultation");
          }}
          ai={ai}
        />
      )}
      {appointmentDialog && <AppointmentDialogReal mode={appointmentDialog} patients={patients} doctors={doctors} token={token} onClose={() => setAppointmentDialog(null)} onSaved={async () => { setAppointmentDialog(null); setToast("Appointment saved"); await refreshAppts(); }} />}
      {appointmentEdit && <AppointmentDialogReal mode={appointmentEdit} patients={patients} doctors={doctors} token={token} onClose={() => setAppointmentEdit(null)} onSaved={async () => { setAppointmentEdit(null); setToast("Appointment updated"); await refreshAppts(); }} />}
      {profileOpen && <MyProfileDialog token={token} user={user} onClose={() => setProfileOpen(false)} onSaved={auth.refreshUser} toast={setToast} />}
      {assistantOpen && <AIAssistant token={token} patients={patients} ai={ai} open onClose={() => setAssistantOpen(false)} />}
      {isMobile && <MobileNavigation page={page} navItems={navItems} appointmentCount={dash?.appointments_today ?? appts.filter((a) => a.status !== "cancelled").length} moreOpen={moreOpen} setMoreOpen={setMoreOpen} setPage={setPage} />}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function MobileNavigation({ page, navItems, appointmentCount, moreOpen, setMoreOpen, setPage }: { page: Page; navItems: typeof nav; appointmentCount: number; moreOpen: boolean; setMoreOpen: (o: boolean) => void; setPage: (p: Page) => void }) {
  const select = (p: Page) => { setPage(p); setMoreOpen(false); };
  const primary = navItems.slice(0, 4).map((item) => ({ ...item, mobileLabel: item.label === "Appointments" ? "Schedule" : item.label === "Consultation" ? "Visit" : item.label }));
  const mobileMoreNav = navItems.slice(4);
  const moreSelected = mobileMoreNav.some((n) => n.label === page);
  return (
    <>
      <Drawer anchor="bottom" open={moreOpen} onClose={() => setMoreOpen(false)} className="mobile-more-drawer" ModalProps={{ keepMounted: true }} PaperProps={{ component: "section", role: "dialog", "aria-labelledby": "mobile-more-title" }}>
        <Box className="mobile-more-sheet">
          <Box className="mobile-sheet-handle" aria-hidden />
          <Box className="mobile-sheet-heading">
            <Box><Typography id="mobile-more-title" component="h2" variant="h6">More services</Typography><Typography variant="body2" color="text.secondary">Clinic tools and administration</Typography></Box>
            <IconButton aria-label="Close more services" onClick={() => setMoreOpen(false)}><IconX size={20} /></IconButton>
          </Box>
          <List className="mobile-more-list">{mobileMoreNav.map((item) => { const s = page === item.label; return <ListItem key={item.label} disablePadding><ListItemButton selected={s} aria-label={`Navigate to ${item.label}`} aria-current={s ? "page" : undefined} onClick={() => select(item.label)}><ListItemIcon>{item.icon}</ListItemIcon><ListItemText primary={item.label} />{s && <IconChevronRight size={18} aria-hidden />}</ListItemButton></ListItem>; })}</List>
        </Box>
      </Drawer>
      <Box component="nav" className="mobile-bottom-nav" aria-label="Mobile primary navigation">
        {primary.map((item) => { const s = page === item.label; return <Button key={item.label} className={`mobile-nav-item${s ? " is-active" : ""}`} aria-label={`Navigate to ${item.mobileLabel}`} aria-current={s ? "page" : undefined} onClick={() => select(item.label)}>{item.icon}<span>{item.mobileLabel}</span>{item.label === "Appointments" && appointmentCount > 0 && <em aria-label={`${appointmentCount} appointments`}>{appointmentCount}</em>}</Button>; })}
        {mobileMoreNav.length > 0 && <Button className={`mobile-nav-item${moreSelected ? " is-active" : ""}`} aria-label="Open more services" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}><IconNotes size={21} /><span>More</span></Button>}
      </Box>
    </>
  );
}
// ---------------------------------------------------------------------------
// Dashboard (real)
// ---------------------------------------------------------------------------
function DashboardFull({ role, dash, appts, doctors, patientById, go }: { role: UserRole; dash: DashboardSummary | null; appts: AppointmentRow[]; doctors: DoctorRow[]; patientById: (id: number) => string; go: (p: Page) => void }) {
  const waiting = appts.filter((a) => a.status === "waiting" || a.status === "booked").length;
  const completedToday = dash?.completed_consultations ?? appts.filter((a) => a.status === "completed").length;
  const metrics: StatCardProps[] = [
    { label: "Appointments", value: String(dash?.appointments_today ?? appts.length), icon: <IconCalendarEvent /> },
    { label: "Waiting", value: String(dash?.waiting_queue ?? waiting), description: `${doctors.length} active doctors`, icon: <IconClock /> },
    ...(role !== "receptionist" ? [{ label: "Consultations", value: String(completedToday), icon: <IconActivity /> }] : []),
    ...(role !== "doctor" ? [{ label: "Collections", value: fmtMoney(dash?.collections_today ?? 0), icon: <IconCash /> }] : []),
  ];
  return (
    <>
      <Box className="stat-grid">
        {metrics.map((metric) => <StatCard key={metric.label} {...metric} />)}
      </Box>
      {dash?.outstanding != null && role !== "doctor" && <Typography variant="caption" color="text.secondary">Outstanding balance: {fmtMoney(dash.outstanding)}</Typography>}
      <Box className="dashboard-grid" sx={{ mt: dash ? 1.5 : 0 }}>
        <Card className="schedule-card"><CardContent>
          <Box className="section-head"><Box><Typography component="h2" variant="h5">Appointments</Typography><Typography variant="body2" color="text.secondary">{istLongDate()}</Typography></Box><Button size="small" endIcon={<IconChevronRight size={16} />} onClick={() => go("Appointments")}>View all</Button></Box>
          {appts.length === 0 && <Box className="schedule-empty"><Typography color="text.secondary">No appointments today.</Typography><Button className="mobile-empty-action" size="small" onClick={() => go("Appointments")}>View appointment schedule</Button></Box>}
          {appts.slice(0, 6).map((a, i) => (
            <Box className="schedule-row" key={a.id}>
              <Typography className="time">{String(a.start_time).slice(0, 5)}</Typography>
              <Box className={`timeline ${i === 0 ? "active" : ""}`}>{i === 0 && <span />}</Box>
              <Avatar className="patient-avatar">{initials(patientById(a.patient_id))}</Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}><Typography fontWeight={700}>{patientById(a.patient_id)}</Typography><Typography variant="caption" color="text.secondary">{a.reason_for_visit || "Reason not recorded"}, {a.doctor?.display_name ?? "Doctor"}</Typography></Box>
              <Chip label={String(a.status).replace("_", " ")} color={apptStatusColor(a.status)} size="small" variant={a.status === "waiting" ? "outlined" : "filled"} />
            </Box>
          ))}
          {appts.length > 0 && <Typography variant="caption" color="text.secondary">{dash?.waiting_queue ?? 0} waiting for a doctor.</Typography>}
        </CardContent></Card>
      </Box>
    </>
  );
}

// ---------------------------------------------------------------------------
// Patients (real)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Consultation (real visits)
// ---------------------------------------------------------------------------
function ConsultationReal({ role, currentUserId, patients, doctors, token, toast, ai, target, onClearTarget }: { role: UserRole; currentUserId: number; patients: PatientRow[]; doctors: DoctorRow[]; token: string; toast: (s: string) => void; ai: AiStatus | null; target?: { patientId?: number; appointmentId?: number } | null; onClearTarget?: () => void }) {
  const [selectedPatient, setSelectedPatient] = useState<number | "">(patients[0]?.id ?? "");
  const [selectedPatientRow, setSelectedPatientRow] = useState<PatientRow | null>(patients[0] ?? null);
  const [selectedDoctor, setSelectedDoctor] = useState<number | "">("");
  const [linkedAppointmentId, setLinkedAppointmentId] = useState<number | null>(null);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientMatches, setPatientMatches] = useState<PatientRow[]>([]);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [visitMeta, setVisitMeta] = useState<Paginated<VisitRow> | null>(null);
  const [visitPage, setVisitPage] = useState(1);
  const [visitPerPage, setVisitPerPage] = useState(10);
  const [visitSearch, setVisitSearch] = useState("");
  const [visitStatus, setVisitStatus] = useState("");
  const [activeVisit, setActiveVisit] = useState<VisitRow | null>(null);
  const [visitLoading, setVisitLoading] = useState(false);
  const [visitError, setVisitError] = useState("");
  const [pendingSwitch, setPendingSwitch] = useState<{ patient: PatientRow | null } | { visit: VisitRow } | null>(null);
  const [focusVisitId, setFocusVisitId] = useState<number | null>(null);
  const clinicalPanel = useRef<HTMLDivElement | null>(null);
  const [symptoms, setSymptoms] = useState("");
  const [vitals, setVitals] = useState<Record<string, string>>({ bp: "", pulse: "", temp: "", weight: "" });
  const [exam, setExam] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [plan, setPlan] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState(false);
  const debouncedPatientSearch = useDebounced(patientSearch, 250);
  const debouncedVisitSearch = useDebounced(visitSearch, 300);
  const clinicianDoctors = role === "doctor" ? doctors.filter((d) => d.user_id === currentUserId) : doctors;

  const [amendDialogOpen, setAmendDialogOpen] = useState(false);
  const [amendReason, setAmendReason] = useState("Clinical addendum");
  const [amendNotes, setAmendNotes] = useState("");
  const [amendBusy, setAmendBusy] = useState(false);
  const [prescriptionDialogOpen, setPrescriptionDialogOpen] = useState(false);
  const [editingPrescription, setEditingPrescription] = useState<PrescriptionRow | null>(null);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [remoteNotesChanged, setRemoteNotesChanged] = useState(false);
  const savedNotes = useRef("");
  const notesSnapshot = (v: Pick<VisitRow, "symptoms" | "examination_notes" | "diagnosis" | "treatment_plan" | "follow_up_date" | "vitals">) => JSON.stringify([
    v.symptoms ?? "", v.examination_notes ?? "", v.diagnosis ?? "", v.treatment_plan ?? "", v.follow_up_date ?? "",
    ["bp", "pulse", "temp", "weight"].map((key) => v.vitals?.[key] ?? ""),
  ]);
  const currentNotes = useRef({ id: activeVisit?.id, snapshot: "" });
  const clinicalGeneration = useRef(0);
  const visitListRequest = useRef(0);
  const visitOpenRequest = useRef(0);
  const openingVisit = useRef<number | null>(null);
  const selectedPatientRef = useRef(selectedPatient);
  selectedPatientRef.current = selectedPatient;
  const clinicalBusy = useRef(false);
  clinicalBusy.current = busy || amendBusy;
  const nextNotes = { id: activeVisit?.id, snapshot: notesSnapshot({ symptoms, examination_notes: exam, diagnosis, treatment_plan: plan, follow_up_date: followUp, vitals }) };
  if (nextNotes.id !== currentNotes.current.id || nextNotes.snapshot !== currentNotes.current.snapshot) clinicalGeneration.current += 1;
  currentNotes.current = nextNotes;
  if (!savedNotes.current) savedNotes.current = nextNotes.snapshot;
  const patientOptions = Array.from(new Map([
    ...(selectedPatientRow ? [selectedPatientRow] : []), ...patients, ...patientMatches,
  ].map((patient) => [patient.id, patient])).values());
  const patient = patientOptions.find((row) => row.id === selectedPatient) ?? null;
  const hasUnsavedNotes = currentNotes.current.snapshot !== savedNotes.current && (Boolean(activeVisit) || Object.values(vitals).some(Boolean));

  const switchPatient = (next: PatientRow | null) => {
    clinicalGeneration.current += 1;
    visitListRequest.current += 1;
    visitOpenRequest.current += 1;
    openingVisit.current = null;
    setFocusVisitId(null);
    selectedPatientRef.current = next?.id ?? "";
    currentNotes.current = { id: undefined, snapshot: "" };
    setSelectedPatient(next?.id ?? ""); setSelectedPatientRow(next);
    setPatientSearch(next ? `${patientDisplay(next)} (${next.patient_number})` : "");
    setActiveVisit(null); setVisits([]); setVisitMeta(null); setVisitPage(1);
    setSymptoms(""); setExam(""); setDiagnosis(""); setPlan(""); setFollowUp("");
    setVitals({ bp: "", pulse: "", temp: "", weight: "" });
    savedNotes.current = notesSnapshot({});
    setRemoteNotesChanged(false); setVisitError(""); setVisitLoading(Boolean(next));
    setAmendDialogOpen(false); setAmendNotes("");
  };

  useEffect(() => {
    if (target?.patientId) {
      const match = patients.find((p) => p.id === target.patientId);
      if (match) {
        switchPatient(match);
      } else {
        patientApi.get(token, target.patientId)
          .then((res) => {
            const p = (res as unknown as { data: PatientRow }).data;
            switchPatient(p);
          })
          .catch(() => {});
      }
      setLinkedAppointmentId(target.appointmentId ?? null);
      onClearTarget?.();
    }
  }, [target]);

  useEffect(() => {
    patientApi.list(token, { page: 1, per_page: 50, search: debouncedPatientSearch || undefined, sort: "first_name", direction: "asc" })
      .then((r) => setPatientMatches((r as unknown as { data: Paginated<PatientRow> }).data.data))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : "Could not search patients."));
  }, [token, debouncedPatientSearch, toast]);
  useEffect(() => { setVisitPage(1); }, [debouncedVisitSearch, visitStatus, visitPerPage]);

  const openVisit = useCallback(async (v: VisitRow, focus = false) => {
    if (v.patient_id !== selectedPatientRef.current) return;
    const request = ++visitOpenRequest.current;
    openingVisit.current = v.id;
    const generation = ++clinicalGeneration.current;
    setVisitLoading(true); setVisitError("");
    try {
      const res = await visitApi.get(token, v.id);
      if (request !== visitOpenRequest.current || generation !== clinicalGeneration.current || v.patient_id !== selectedPatientRef.current) return;
      const full = (res as unknown as { data: VisitRow }).data;
      if (full.patient_id !== selectedPatientRef.current) throw new Error("This consultation does not belong to the selected patient.");
      savedNotes.current = notesSnapshot(full);
      currentNotes.current = { id: full.id, snapshot: savedNotes.current };
      setRemoteNotesChanged(false);
      setActiveVisit(full);
      setSelectedDoctor(full.doctor_id);
      setSymptoms(full.symptoms ?? "");
      setExam(full.examination_notes ?? "");
      setDiagnosis(full.diagnosis ?? "");
      setPlan(full.treatment_plan ?? "");
      setFollowUp(full.follow_up_date ?? "");
      setVitals((full.vitals as Record<string, string>) ?? { bp: "", pulse: "", temp: "", weight: "" });
      if (focus) setFocusVisitId(full.id);
    } catch (error) {
      if (request !== visitOpenRequest.current || generation !== clinicalGeneration.current) return;
      setVisitError(error instanceof Error ? error.message : "Could not open this consultation.");
    } finally {
      if (request === visitOpenRequest.current) {
        openingVisit.current = null;
        setVisitLoading(false);
      }
    }
  }, [token]);
  useEffect(() => {
    if (focusVisitId === null || focusVisitId !== activeVisit?.id || visitLoading) return;
    const panel = clinicalPanel.current;
    if (panel) {
      const header = panel.closest(".app-frame")?.querySelector("header");
      panel.style.scrollMarginTop = `${header?.getBoundingClientRect().height ?? 0}px`;
      panel.scrollIntoView({ block: "start" });
      panel.focus({ preventScroll: true });
    }
    setFocusVisitId(null);
  }, [focusVisitId, activeVisit?.id, visitLoading]);

  const requestSwitch = (target: { patient: PatientRow | null } | { visit: VisitRow }) => {
    if ("visit" in target && target.visit.id === currentNotes.current.id) {
      setFocusVisitId(target.visit.id);
      return;
    }
    if (hasUnsavedNotes || amendNotes.trim()) {
      setPendingSwitch(target);
      setPatientSearch(patient ? `${patientDisplay(patient)} (${patient.patient_number})` : "");
      return;
    }
    if ("patient" in target) switchPatient(target.patient);
    else void openVisit(target.visit, true);
  };

  const fetchVisits = useCallback(async (background = false) => {
    const request = ++visitListRequest.current;
    if (!selectedPatient) { setVisitLoading(false); return; }
    if (!background) setVisitLoading(true);
    try {
    const res = await visitApi.list(token, { patient_id: selectedPatient, page: visitPage, per_page: visitPerPage, search: debouncedVisitSearch || undefined, status: visitStatus || undefined, sort: "visit_date", direction: "desc" });
    if (request !== visitListRequest.current || selectedPatient !== selectedPatientRef.current) return;
    const meta = (res as unknown as { data: Paginated<VisitRow> }).data;
    const list = meta.data;
    setVisitMeta(meta);
    setVisits(list);
    setVisitError("");
    if (list.length && !currentNotes.current.id && openingVisit.current === null && !clinicalBusy.current && currentNotes.current.snapshot === savedNotes.current) {
      await openVisit(list[0]);
    }
    } catch (error) {
      if (request === visitListRequest.current) setVisitError(error instanceof Error ? error.message : "Could not load consultations.");
    } finally {
      if (request === visitListRequest.current && openingVisit.current === null) setVisitLoading(false);
    }
  }, [token, selectedPatient, visitPage, visitPerPage, debouncedVisitSearch, visitStatus, openVisit]);
  useEffect(() => { void fetchVisits(); }, [fetchVisits]);
  useEffect(() => () => { clinicalGeneration.current += 1; visitListRequest.current += 1; visitOpenRequest.current += 1; }, []);
  useLiveRefresh(async () => {
    await fetchVisits(true);
    const matches = await patientApi.list(token, { page: 1, per_page: 50, search: debouncedPatientSearch || undefined, sort: "first_name", direction: "asc" });
    setPatientMatches((matches as unknown as { data: Paginated<PatientRow> }).data.data);
    const id = currentNotes.current.id;
    if (!id || clinicalBusy.current || openingVisit.current !== null) return;
    const generation = clinicalGeneration.current;
    const result = await visitApi.get(token, id);
    const full = (result as unknown as { data: VisitRow }).data;
    if (currentNotes.current.id !== id || generation !== clinicalGeneration.current || clinicalBusy.current || openingVisit.current !== null || full.patient_id !== selectedPatientRef.current) return;
    if (currentNotes.current.snapshot !== savedNotes.current) {
      if (notesSnapshot(full) !== savedNotes.current || full.status !== activeVisit?.status) setRemoteNotesChanged(true);
      setActiveVisit((previous) => previous?.id === id ? { ...previous, status: full.status, amendments: full.amendments } : previous);
    } else {
      savedNotes.current = notesSnapshot(full);
      setRemoteNotesChanged(false);
      setActiveVisit(full);
      setSymptoms(full.symptoms ?? ""); setExam(full.examination_notes ?? "");
      setDiagnosis(full.diagnosis ?? ""); setPlan(full.treatment_plan ?? "");
      setFollowUp(full.follow_up_date ?? "");
      setVitals((full.vitals as Record<string, string>) ?? { bp: "", pulse: "", temp: "", weight: "" });
    }
  });
  useEffect(() => { if (clinicianDoctors[0] && !selectedDoctor) setSelectedDoctor(clinicianDoctors[0].id); }, [clinicianDoctors, selectedDoctor]);

  const startVisit = async () => {
    if (clinicalBusy.current) return;
    if (!selectedPatient || !selectedDoctor || visitLoading) { toast("Select patient and doctor"); return; }
    const generation = ++clinicalGeneration.current;
    clinicalBusy.current = true;
    setBusy(true);
    try {
      const res = await visitApi.create(token, {
        patient_id: selectedPatient, doctor_id: selectedDoctor, appointment_id: linkedAppointmentId || undefined, visit_date: istDate(),
        vitals: activeVisit ? { bp: "", pulse: "", temp: "", weight: "" } : vitals,
      });
      if (generation !== clinicalGeneration.current) return;
      const created = res.data;
      savedNotes.current = notesSnapshot(created);
      currentNotes.current = { id: created.id, snapshot: savedNotes.current };
      setActiveVisit(created);
      setSelectedDoctor(created.doctor_id);
      setSymptoms(created.symptoms ?? ""); setExam(created.examination_notes ?? "");
      setDiagnosis(created.diagnosis ?? ""); setPlan(created.treatment_plan ?? "");
      setFollowUp(created.follow_up_date ?? "");
      setVitals((created.vitals as Record<string, string>) ?? { bp: "", pulse: "", temp: "", weight: "" });
      setRemoteNotesChanged(false); setVisitError("");
      toast("Consultation started");
      await fetchVisits(true);
    } catch (e: unknown) { toast(e instanceof Error ? e.message : "Failed to start visit"); } finally { setBusy(false); }
  };
  const saveDraft = async () => {
    if (!activeVisit || visitLoading || activeVisit.patient_id !== selectedPatient) return;
    clinicalGeneration.current += 1;
    setBusy(true);
    try {
      await visitApi.update(token, activeVisit.id, { symptoms, vitals, examination_notes: exam, diagnosis, treatment_plan: plan, follow_up_date: followUp || null });
      savedNotes.current = notesSnapshot({ symptoms, vitals, examination_notes: exam, diagnosis, treatment_plan: plan, follow_up_date: followUp });
      setRemoteNotesChanged(false);
      toast("Draft saved");
    } catch (e: unknown) { toast(e instanceof Error ? e.message : "Save failed"); } finally { setBusy(false); }
  };
  const finalize = async () => {
    if (!activeVisit || visitLoading || activeVisit.patient_id !== selectedPatient) return;
    clinicalGeneration.current += 1;
    setBusy(true);
    try { await visitApi.finalize(token, activeVisit.id); setActiveVisit({ ...activeVisit, status: "finalized" }); toast("Consultation finalized — now read-only"); }
    catch (e: unknown) { toast(e instanceof Error ? e.message : "Finalize failed"); } finally { setBusy(false); }
  };

  const doAmend = async () => {
    if (!activeVisit || visitLoading || activeVisit.patient_id !== selectedPatient || !amendReason.trim() || !amendNotes.trim()) return;
    clinicalGeneration.current += 1;
    setAmendBusy(true);
    try {
      const res = await visitApi.amend(token, activeVisit.id, { reason: amendReason.trim(), notes: amendNotes.trim() });
      const newAmend = (res as unknown as { data: import("./api").VisitAmendmentRow }).data;
      const updatedAmendments = [newAmend, ...(activeVisit.amendments || [])];
      setActiveVisit({ ...activeVisit, status: "amended", amendments: updatedAmendments });
      setAmendDialogOpen(false);
      setAmendReason("Clinical addendum");
      setAmendNotes("");
      toast("Amendment recorded to consultation");
      await fetchVisits();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Amendment failed");
    } finally {
      setAmendBusy(false);
    }
  };

  const finalized = activeVisit?.status === "finalized" || activeVisit?.status === "amended";

  /** The AI draft panel showed every value; accepting copies them into the form. */
  const applyAiDraft = (d: AiConsultDraft) => {
    if (d.examination_notes?.trim()) setExam(d.examination_notes.trim());
    if (d.diagnosis?.trim()) setDiagnosis(d.diagnosis.trim());
    const planParts = [d.treatment_plan?.trim() ?? "", d.follow_up_suggestion?.trim() ?? ""].filter(Boolean);
    if (planParts.length > 0) setPlan(planParts.join("\n"));
    if (d.follow_up_date?.trim()) setFollowUp(d.follow_up_date.trim());
  };

  return (
    <>
      {remoteNotesChanged && <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" onClick={() => activeVisit && void openVisit(activeVisit)}>Reload saved notes</Button>}>This consultation changed elsewhere. Your unsaved notes are kept; reloading replaces them.</Alert>}
      {visitError && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" onClick={() => void fetchVisits()}>Retry</Button>}>{visitError}</Alert>}
      <Box className="consult-grid">
        <Card><CardContent>
          <Typography component="h2" variant="h5">Visit details</Typography>
          <Autocomplete
            options={patientOptions}
            value={patient}
            disabled={busy || amendBusy}
            getOptionLabel={(p) => `${patientDisplay(p)} (${p.patient_number})`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            onChange={(_, p) => { if ((p?.id ?? "") !== selectedPatient) requestSwitch({ patient: p }); }}
            inputValue={patientSearch}
            onInputChange={(_, value) => setPatientSearch(value)}
            renderInput={(params) => <TextField {...params} label="Patient" placeholder="Search name, phone or patient ID" />}
            sx={{ mt: 2 }}
          />
          {role === "doctor" ? <TextField fullWidth label="Doctor" value={clinicianDoctors[0]?.display_name ?? "No doctor profile linked"} InputProps={{ readOnly: true }} sx={{ mt: 2 }} /> : <TextField select fullWidth label="Doctor" value={selectedDoctor} onChange={(e) => setSelectedDoctor(Number(e.target.value))} sx={{ mt: 2 }}>{clinicianDoctors.map((d) => <MenuItem key={d.id} value={d.id}>{d.display_name}, fee {fmtMoney(d.consultation_fee)}</MenuItem>)}</TextField>}
          {(!activeVisit || finalized) && <Button variant="contained" fullWidth sx={{ mt: 2 }} disabled={busy || visitLoading || !selectedPatient || !selectedDoctor} onClick={() => void startVisit()}>{busy ? <CircularProgress size={18} /> : activeVisit ? "Start new consultation" : "Start consultation"}</Button>}
          {visitLoading && <Typography role="status" variant="body2" color="text.secondary" sx={{ mt: 2 }}>Loading consultations...</Typography>}
          <Box className="patient-summary">
            <Avatar className="large-avatar">{patient ? initials(patientDisplay(patient)) : "?"}</Avatar>
            <Box><Typography fontWeight={700}>{activeVisit ? `Visit ${activeVisit.visit_number}` : "No active visit"}</Typography><Typography variant="body2" color="text.secondary">{activeVisit ? `${String(activeVisit.visit_date).slice(0, 10)} (IST), ${activeVisit.status.charAt(0).toUpperCase()}${activeVisit.status.slice(1)}` : patient ? "Start a visit to capture notes" : "Select a patient to view consultations"}</Typography><Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ mt: 1 }}>{patient?.allergies_summary && <Chip label={patient.allergies_summary} size="small" color="warning" variant="outlined" />}{linkedAppointmentId && <Chip label={`Appointment #${linkedAppointmentId}`} size="small" color="primary" variant="outlined" />}</Stack></Box>
          </Box>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" className="field-label">VITALS</Typography>
          <Box className="vitals-grid">
            <TextField label="Blood pressure (mmHg)" value={vitals.bp} onChange={(e) => setVitals((v) => ({ ...v, bp: e.target.value }))} disabled={finalized || visitLoading || busy} />
            <TextField label="Pulse (bpm)" value={vitals.pulse} onChange={(e) => setVitals((v) => ({ ...v, pulse: e.target.value }))} disabled={finalized || visitLoading || busy} />
            <TextField label="Temperature (°C)" value={vitals.temp} onChange={(e) => setVitals((v) => ({ ...v, temp: e.target.value }))} disabled={finalized || visitLoading || busy} />
            <TextField label="Weight (kg)" value={vitals.weight} onChange={(e) => setVitals((v) => ({ ...v, weight: e.target.value }))} disabled={finalized || visitLoading || busy} />
          </Box>
          <Accordion disableGutters elevation={0} sx={{ mt: 2, border: "1px solid #e5ece8", borderRadius: "12px !important", "&:before": { display: "none" } }}>
            <AccordionSummary expandIcon={<IconChevronRight size={18} />}><Typography component="h3" variant="subtitle2">Consultation history{visitMeta ? ` (${visitMeta.total})` : ""}</Typography></AccordionSummary>
            <AccordionDetails>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 1 }}><TextField size="small" label="Search visits" value={visitSearch} onChange={(e) => setVisitSearch(e.target.value)} /><FilterSelect label="Status" value={visitStatus} onChange={setVisitStatus} width={145} options={[{ value: "draft", label: "Draft" }, { value: "finalized", label: "Finalized" }, { value: "amended", label: "Amended" }]} /></Stack>
              {visits.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>No consultations match these filters.</Typography>}
               {visits.map((v) => <Box key={v.id} sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1, py: 1, borderBottom: "1px solid #edf1ef" }}><Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={700}>{v.visit_number}, {String(v.visit_date).slice(0, 10)}</Typography><Typography variant="caption" color="text.secondary">{v.patient ? patientDisplay(v.patient) : `Patient ${v.patient_id}`}, {v.diagnosis || "No diagnosis recorded"}</Typography></Box><Button size="small" aria-label={`Open consultation ${v.visit_number}`} aria-current={activeVisit?.id === v.id ? "true" : undefined} disabled={busy || amendBusy || visitLoading} onClick={() => requestSwitch({ visit: v })}>Open</Button></Box>)}
              {visitMeta && <PagerBar page={visitMeta.current_page} lastPage={visitMeta.last_page} total={visitMeta.total} perPage={visitPerPage} onPage={setVisitPage} onPerPage={(n) => { setVisitPerPage(n); setVisitPage(1); }} />}
            </AccordionDetails>
          </Accordion>
        </CardContent></Card>
        <Card ref={clinicalPanel} tabIndex={-1} role="region" aria-label="Clinical notes"><CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography component="h2" variant="h5">Clinical notes</Typography>
              <Typography variant="body2" color="text.secondary">
                {activeVisit?.status === "amended" ? "Amended, audited read-only" : finalized ? "Finalized, read-only" : activeVisit ? "Draft" : "Select or start a visit"}
              </Typography>
            </Box>
            <Chip
              label={activeVisit?.status === "amended" ? "Amended" : finalized ? "Finalized" : activeVisit ? "Draft" : "No visit"}
              color={activeVisit?.status === "amended" ? "info" : finalized ? "success" : "warning"}
              size="small"
            />
          </Stack>
          <TextField fullWidth multiline minRows={2} label="Presenting symptoms" value={symptoms} onChange={(e) => setSymptoms(e.target.value)} disabled={finalized || !activeVisit || visitLoading} sx={{ mt: 2 }} />
          <TextField fullWidth multiline minRows={2} label="Examination notes" value={exam} onChange={(e) => setExam(e.target.value)} disabled={finalized || !activeVisit || visitLoading} sx={{ mt: 2 }} />
          <TextField fullWidth label="Diagnosis" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} disabled={finalized || !activeVisit || visitLoading} sx={{ mt: 2 }} />
          <TextField fullWidth multiline minRows={3} label="Treatment plan" value={plan} onChange={(e) => setPlan(e.target.value)} disabled={finalized || !activeVisit || visitLoading} sx={{ mt: 2 }} />
          <TextField type="date" fullWidth label="Follow-up date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} disabled={finalized || !activeVisit || visitLoading} InputLabelProps={{ shrink: true }} sx={{ mt: 2 }} />

          <AiConsultAssist
            token={token}
            ai={ai}
            visit={activeVisit}
            disabled={busy || visitLoading}
            busyParent={busy || visitLoading}
            onApply={applyAiDraft}
            toast={toast}
          />

          {/* Audited Amendments List */}
          {activeVisit?.amendments && activeVisit.amendments.length > 0 && (
            <Box sx={{ mt: 2.5, p: 2, bgcolor: "#f8faf9", borderRadius: 2, border: "1px solid #e1e8e4" }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, display: "flex", alignItems: "center", gap: 0.5 }}>
                <IconFileAnalytics size={16} /> Audited amendments & addenda ({activeVisit.amendments.length})
              </Typography>
              <Stack spacing={1.5}>
                {activeVisit.amendments.map((am) => (
                  <Box key={am.id} sx={{ p: 1.5, bgcolor: "#ffffff", borderRadius: 1.5, border: "1px solid #e5ece8" }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                      <Chip size="small" label={am.reason} color="info" variant="outlined" />
                      <Typography variant="caption" color="text.secondary">
                        {istDateTime(am.created_at)}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>{am.notes}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                      Recorded by: {am.doctor?.display_name || am.user?.name || "Clinician"}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}

          {/* Prescriptions & Medications Section */}
          {activeVisit && (
            <Box sx={{ mt: 2.5, p: 2, bgcolor: "#f6faf8", borderRadius: 2, border: "1px solid #dbeae2" }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 0.75 }}>
                  <IconPill size={18} /> Prescriptions & medications ({activeVisit.prescriptions?.length || 0})
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<IconPill size={15} />}
                  disabled={busy || visitLoading}
                  onClick={() => { setEditingPrescription(null); setPrescriptionDialogOpen(true); }}
                >
                  Write prescription
                </Button>
              </Stack>
              {(!activeVisit.prescriptions || activeVisit.prescriptions.length === 0) ? (
                <Typography variant="body2" color="text.secondary">
                  No prescriptions written for this consultation yet. Click "Write prescription" to add medicines and instructions.
                </Typography>
              ) : (
                <Stack spacing={1.5}>
                  {activeVisit.prescriptions.map((rx) => (
                    <Box key={rx.id} sx={{ p: 1.5, bgcolor: "#ffffff", borderRadius: 1.5, border: "1px solid #e2ebe6" }}>
                      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={1} sx={{ mb: 1 }}>
                        <Box>
                          <Typography variant="subtitle2" className="mono" sx={{ fontWeight: 700 }}>
                            {rx.prescription_number}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {rx.issued_at ? String(rx.issued_at).slice(0, 10) : "Draft"} • {(rx.items || []).length} medicine{(rx.items || []).length === 1 ? "" : "s"}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip
                            size="small"
                            label={rx.status}
                            color={rx.status === "finalized" ? "success" : rx.status === "draft" ? "warning" : "default"}
                          />
                          {rx.status === "draft" && (
                            <>
                              <Button
                                size="small"
                                variant="outlined"
                                color="inherit"
                                onClick={() => { setEditingPrescription(rx); setPrescriptionDialogOpen(true); }}
                              >
                                Edit
                              </Button>
                              <Button
                                size="small"
                                variant="contained"
                                color="success"
                                onClick={async () => {
                                  try {
                                    await prescriptionApi.finalize(token, rx.id);
                                    toast(`${rx.prescription_number} finalized`);
                                    await openVisit(activeVisit);
                                  } catch (e: unknown) {
                                    toast(e instanceof Error ? e.message : "Could not finalize prescription");
                                  }
                                }}
                              >
                                Finalize
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                onClick={async () => {
                                  try {
                                    await prescriptionApi.remove(token, rx.id);
                                    toast("Draft prescription deleted");
                                    await openVisit(activeVisit);
                                  } catch (e: unknown) {
                                    toast(e instanceof Error ? e.message : "Could not delete prescription");
                                  }
                                }}
                              >
                                Delete
                              </Button>
                            </>
                          )}
                          {rx.status === "finalized" && (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<IconPrinter size={14} />}
                              onClick={() => void printPrescriptionDoc(token, rx.id, toast)}
                            >
                              Print
                            </Button>
                          )}
                        </Stack>
                      </Stack>
                      {rx.items && rx.items.length > 0 && (
                        <Box sx={{ pl: 1, borderLeft: "2px solid #00796b", mt: 1 }}>
                          {rx.items.map((it, idx) => (
                            <Typography key={idx} variant="body2" sx={{ py: 0.25 }}>
                              • <strong>{it.medicine_name}</strong> {it.strength || ""} — {it.dosage}, {it.route ? `${it.route}, ` : ""}{it.frequency} for {it.duration}
                            </Typography>
                          ))}
                        </Box>
                      )}
                      {rx.instructions && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75, fontStyle: "italic" }}>
                          Instructions: {rx.instructions}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>
          )}

          {/* Invoicing & Billing Section (Finalized / Amended Visits) */}
          {activeVisit && finalized && (
            <Box sx={{ mt: 2.5, p: 2, bgcolor: "#fbf9f4", borderRadius: 2, border: "1px solid #ede3d2" }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 0.75 }}>
                  <IconReceipt size={18} /> Consultation billing & invoices ({activeVisit.invoices?.length || 0})
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  startIcon={<IconReceipt size={15} />}
                  disabled={busy || visitLoading}
                  onClick={() => setInvoiceDialogOpen(true)}
                >
                  {activeVisit.invoices && activeVisit.invoices.length > 0 ? "Create additional invoice" : "Generate invoice"}
                </Button>
              </Stack>
              {(!activeVisit.invoices || activeVisit.invoices.length === 0) ? (
                <Typography variant="body2" color="text.secondary">
                  This consultation has no invoice generated yet. Click "Generate invoice" to bill the patient for consultation and clinic services.
                </Typography>
              ) : (
                <Stack spacing={1.5}>
                  {activeVisit.invoices.map((inv) => (
                    <Box key={inv.id} sx={{ p: 1.5, bgcolor: "#ffffff", borderRadius: 1.5, border: "1px solid #e8e2d5" }}>
                      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={1}>
                        <Box>
                          <Typography variant="subtitle2" className="mono" sx={{ fontWeight: 700 }}>
                            {inv.invoice_number}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Date: {String(inv.invoice_date).slice(0, 10)} • Total: ₹ {Number(inv.total_amount).toLocaleString("en-IN")}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip
                            size="small"
                            label={inv.status.replace(/_/g, " ")}
                            color={inv.status === "paid" ? "success" : inv.status === "void" ? "default" : "warning"}
                          />
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<IconPrinter size={14} />}
                            onClick={() => void printReceiptDoc(token, inv.id, toast)}
                          >
                            Receipt
                          </Button>
                        </Stack>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>
          )}

          <Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ mt: 2 }} flexWrap="wrap">
            {activeVisit && (
              <Button
                variant="outlined"
                disabled={visitLoading || busy}
                startIcon={<IconPill size={16} />}
                onClick={() => { setEditingPrescription(null); setPrescriptionDialogOpen(true); }}
              >
                Write prescription
              </Button>
            )}
            {!finalized && (
              <>
                <Button variant="outlined" disabled={!activeVisit || busy || visitLoading} onClick={() => void saveDraft()}>{busy ? <CircularProgress size={18} /> : "Save draft"}</Button>
                <Button variant="contained" disabled={!activeVisit || busy || visitLoading} onClick={() => void finalize()}>Finalize consultation</Button>
              </>
            )}
            {finalized && (
              <>
                <Button variant="outlined" disabled={visitLoading || busy} startIcon={<IconReceipt size={16} />} onClick={() => setInvoiceDialogOpen(true)}>
                  Generate bill
                </Button>
                <Button variant="contained" color="primary" disabled={visitLoading} startIcon={<IconEdit size={16} />} onClick={() => setAmendDialogOpen(true)}>
                  Add amendment
                </Button>
              </>
            )}
          </Stack>
        </CardContent></Card>
      </Box>

      {prescriptionDialogOpen && activeVisit && (
        <PrescriptionForm
          token={token}
          ai={ai}
          initial={editingPrescription}
          presetVisit={activeVisit}
          onClose={() => { setPrescriptionDialogOpen(false); setEditingPrescription(null); }}
          onSaved={async () => {
            setPrescriptionDialogOpen(false);
            setEditingPrescription(null);
            toast(editingPrescription ? "Prescription updated" : "Prescription created");
            await openVisit(activeVisit);
          }}
        />
      )}

      {invoiceDialogOpen && activeVisit && (
        <InvoiceCreate
          token={token}
          presetVisit={activeVisit}
          onClose={() => setInvoiceDialogOpen(false)}
          onCreated={async () => {
            setInvoiceDialogOpen(false);
            toast("Invoice created for consultation");
            await openVisit(activeVisit);
          }}
        />
      )}

      <Dialog open={Boolean(pendingSwitch)} onClose={() => setPendingSwitch(null)} aria-labelledby="consultation-switch-title" aria-describedby="consultation-switch-description" fullWidth maxWidth="xs" sx={{ "& .MuiDialogActions-root": { padding: "16px !important", alignItems: "stretch" }, "& .MuiDialogActions-root .MuiButton-root": { minHeight: 44, p: 1 } }}>
        <DialogTitle id="consultation-switch-title">Discard unsaved notes?</DialogTitle>
        <DialogContent sx={{ pb: 2 }}><Typography id="consultation-switch-description">Switching consultations will discard your unsaved notes and vitals.</Typography></DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button autoFocus onClick={() => setPendingSwitch(null)}>Keep editing</Button>
          <Button color="error" onClick={() => {
            const target = pendingSwitch; setPendingSwitch(null);
            if (!target) return;
            if ("patient" in target) switchPatient(target.patient);
            else { setAmendDialogOpen(false); setAmendNotes(""); void openVisit(target.visit, true); }
          }}>Discard and switch</Button>
        </DialogActions>
      </Dialog>

      {/* Consultation Amendment Dialog */}
      <Dialog open={amendDialogOpen} onClose={() => setAmendDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 700 }}>Add clinical amendment / addendum</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Finalized medical records are legally immutable. Amendments append an audited addendum stamped with your credentials and timestamp.
          </Typography>
          <TextField
            select
            fullWidth
            label="Reason for amendment *"
            value={amendReason}
            onChange={(e) => setAmendReason(e.target.value)}
            sx={{ mb: 2 }}
          >
            <MenuItem value="Clinical addendum">Clinical addendum (general update)</MenuItem>
            <MenuItem value="Lab / diagnostic report update">Lab / diagnostic report update</MenuItem>
            <MenuItem value="Correction of notes">Correction of clinical notes</MenuItem>
            <MenuItem value="Post-consultation follow-up">Post-consultation follow-up note</MenuItem>
            <MenuItem value="Late entry">Late entry</MenuItem>
          </TextField>
          <TextField
            fullWidth
            multiline
            minRows={4}
            required
            label="Addendum / amendment notes *"
            placeholder="Record the clinical details, lab findings or clarification..."
            value={amendNotes}
            onChange={(e) => setAmendNotes(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAmendDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={amendBusy || !amendNotes.trim()} onClick={() => void doAmend()}>
            {amendBusy ? <CircularProgress size={18} /> : "Record amendment"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Reports (real, with CSV)
// ---------------------------------------------------------------------------
function ReportsReal({ token }: { token: string }) {
  const [from, setFrom] = useState(() => istMonthStart());
  const [to, setTo] = useState(() => istDate());
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<"collections" | "appointments" | "patients" | "doctor-consultations">("collections");
  const [err, setErr] = useState("");
  const load = useCallback(async (r: typeof active, background = false) => {
    setActive(r); setErr(""); if (!background) { setData(null); setLoading(true); }
    try {
      const res = await reportApi.fetch(token, r, { from, to }) as unknown as { data: unknown };
      setData(res.data);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed to load report"); }
    finally { if (!background) setLoading(false); }
  }, [token, from, to]);
  useEffect(() => { void load(active); }, [load, active]);
  useLiveRefresh(() => load(active, true));
  const csvHref = useMemo(() => {
    return reportApi.csvUrl(active, { from, to });
  }, [active, from, to]);

  return (
    <>
      <Card><CardContent>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ flexWrap: "wrap", mb: 2 }}>
          <TextField type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
          <Button variant="outlined" onClick={() => void load(active)}>Apply</Button>
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
          <Tabs value={active} onChange={(_, value) => void load(value)} variant="scrollable" allowScrollButtonsMobile aria-label="Report type">
            <Tab value="collections" label="Collections" />
            <Tab value="appointments" label="Appointments" />
            <Tab value="patients" label="Patients" />
            <Tab value="doctor-consultations" label="Consultations by doctor" />
          </Tabs>
          <Button size="small" startIcon={<IconDownload size={16} />} onClick={() => {
            fetch(csvHref, { headers: { Authorization: `Bearer ${token}` } }).then(async (res) => {
              if (!res.ok) throw new Error(await res.text());
              const blob = await res.blob(); const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = `${active}.csv`; a.click(); URL.revokeObjectURL(url);
            }).catch((ex: unknown) => setErr(ex instanceof Error ? ex.message : "CSV download failed"));
          }}>Export CSV</Button>
        </Stack>
        {err && <Alert severity="error" sx={{ mt: 2 }}>{err}</Alert>}
        {loading && <Box sx={{ display: "grid", placeItems: "center", py: 5 }}><CircularProgress /></Box>}
        {!loading && active === "patients" && data != null && <Card variant="outlined" sx={{ mt: 2 }}><CardContent><Typography variant="body2" color="text.secondary">New patient records in selected period</Typography><Typography className="stat-value">{String((data as { count?: number }).count ?? 0)}</Typography></CardContent></Card>}
        {!loading && Array.isArray(data) && data.length === 0 && <Typography color="text.secondary" sx={{ py: 3 }}>No report rows in this date range.</Typography>}
        {!loading && Array.isArray(data) && data.length > 0 && active === "collections" && <Box className="table-scroll"><Table><TableHead><TableRow><TableCell>Payment method</TableCell><TableCell align="right">Transactions</TableCell><TableCell align="right">Collected</TableCell></TableRow></TableHead><TableBody>{(data as { payment_method: string; count: number; total: string | number }[]).map((row) => <TableRow key={row.payment_method}><TableCell>{row.payment_method.replace(/_/g, " ")}</TableCell><TableCell align="right">{row.count}</TableCell><TableCell align="right" sx={{ fontWeight: 700 }}>{fmtMoney(row.total)}</TableCell></TableRow>)}</TableBody></Table></Box>}
        {!loading && Array.isArray(data) && data.length > 0 && active === "appointments" && <Box className="table-scroll"><Table><TableHead><TableRow><TableCell>Status</TableCell><TableCell align="right">Appointments</TableCell></TableRow></TableHead><TableBody>{(data as { status: string; count: number }[]).map((row) => <TableRow key={row.status}><TableCell><Chip size="small" label={row.status.replace(/_/g, " ")} color={apptStatusColor(row.status)} /></TableCell><TableCell align="right">{row.count}</TableCell></TableRow>)}</TableBody></Table></Box>}
        {!loading && Array.isArray(data) && data.length > 0 && active === "doctor-consultations" && <Box className="table-scroll"><Table><TableHead><TableRow><TableCell>Doctor</TableCell><TableCell align="right">Completed consultations</TableCell></TableRow></TableHead><TableBody>{(data as { doctor?: { display_name?: string }; count: number }[]).map((row, i) => <TableRow key={i}><TableCell>{row.doctor?.display_name ?? "Doctor"}</TableCell><TableCell align="right">{row.count}</TableCell></TableRow>)}</TableBody></Table></Box>}
      </CardContent></Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Settings (real)
// ---------------------------------------------------------------------------
function SettingsReal({ token, toast, onClinicChanged, onStaff, onAiChanged }: { token: string; toast: (s: string) => void; onClinicChanged?: () => void; onStaff: () => void; onAiChanged: () => void }) {
  const auth = useAuth();
  const [clinic, setClinic] = useState<ClinicSettingRow | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [slot, setSlot] = useState("30");
  const [prefix, setPrefix] = useState("INV");
  const [receiptPrefix, setReceiptPrefix] = useState("RCT");
  const [footer, setFooter] = useState("");
  const [hours, setHours] = useState<ClinicHours | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsStale, setSettingsStale] = useState(false);
  const dirtyRef = useRef(settingsDirty);
  dirtyRef.current = settingsDirty;
  const hydrateClinic = (c: ClinicSettingRow) => {
    setClinic(c); setName(c.clinic_name ?? ""); setAddress(c.address ?? ""); setPhone(c.phone ?? ""); setEmail(c.email ?? ""); setSlot(String(c.appointment_slot_minutes ?? 30)); setPrefix(c.invoice_prefix ?? "INV"); setReceiptPrefix(c.receipt_prefix ?? "RCT"); setFooter(c.prescription_footer ?? "");
    setHours(readClinicHours(c.working_hours));
    setSettingsStale(false);
  };
  useEffect(() => {
    clinicApi.get(token).then((r) => {
      const c = unwrap<ClinicSettingRow>(r as unknown as { data: ClinicSettingRow });
      if (!dirtyRef.current) hydrateClinic(c);
    }).catch(() => {});
  }, [token]);
  useLiveRefresh(async () => {
    const result = await clinicApi.get(token);
    const next = (result as unknown as { data: ClinicSettingRow }).data;
    if (dirtyRef.current) {
      if (JSON.stringify(next) !== JSON.stringify(clinic)) setSettingsStale(true);
    } else hydrateClinic(next);
  });
  const save = async () => {
    setSaving(true);
    try {
      await clinicApi.update(token, { clinic_name: name, address, phone, email, appointment_slot_minutes: Number(slot), invoice_prefix: prefix, receipt_prefix: receiptPrefix, prescription_footer: footer, working_hours: hours });
      toast("Clinic settings saved");
      setSettingsDirty(false); setSettingsStale(false);
      onClinicChanged?.();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : "Save failed"); } finally { setSaving(false); }
  };
  return (
    <>
    {settingsStale && <Alert severity="warning" sx={{ mb: 2 }}>Clinic settings changed elsewhere. Your unsaved changes are kept. Saving will apply your values.</Alert>}
    <Box className="settings-grid" onChange={() => setSettingsDirty(true)}>
      <Card><CardContent>
        <Typography component="h2" variant="h5">Clinic profile</Typography><Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Shown on prescriptions and receipts.</Typography>
        <TextField fullWidth label="Clinic name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField fullWidth label="Address" value={address} onChange={(e) => setAddress(e.target.value)} sx={{ mt: 2 }} />
        <Box className="two-fields"><TextField label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} /><TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} /></Box>
        <TextField fullWidth label="Prescription footer" value={footer} onChange={(e) => setFooter(e.target.value)} sx={{ mt: 2 }} multiline minRows={2} />
        <ClinicLogoUploader token={token} clinic={clinic} onChanged={(next) => { setClinic(next); onClinicChanged?.(); toast(next.logo_path ? "Clinic logo updated" : "Clinic logo removed"); }} />
        <Button variant="contained" sx={{ mt: 2 }} disabled={saving} onClick={() => void save()}>{saving ? <CircularProgress size={18} /> : "Save changes"}</Button>
        {!clinic && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Load the clinic settings to edit — requires admin role.</Typography>}
      </CardContent></Card>
      <Card><CardContent>
        <Typography component="h2" variant="h5">Clinic opening hours</Typography><Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Doctor hours are managed per doctor on Staff.</Typography>
        <TextField fullWidth label="Timezone" value="Asia/Kolkata (IST, UTC+05:30)" InputProps={{ readOnly: true }} sx={{ mb: 2 }} />
        <ClinicHoursEditor value={hours} onChange={(next) => { setSettingsDirty(true); setHours(next); }} />
        <Divider sx={{ my: 2 }} />
        <TextField select fullWidth label="Appointment slot duration" value={slot} onChange={(e) => setSlot(e.target.value)}><MenuItem value="15">15 minutes</MenuItem><MenuItem value="30">30 minutes</MenuItem><MenuItem value="45">45 minutes</MenuItem></TextField>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, mt: 2 }}><TextField label="Invoice prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} /><TextField label="Receipt prefix" value={receiptPrefix} onChange={(e) => setReceiptPrefix(e.target.value)} /></Box>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="subtitle2">Staff accounts</Typography><Button size="small" onClick={onStaff}>Manage staff</Button></Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Signed in as {auth.user?.name}, {auth.user?.role}</Typography>
      </CardContent></Card>
    </Box>
    <Box sx={{ mt: 2 }}>
      <WhatsAppSettings token={token} toast={toast} />
      <Box sx={{ mt: 2 }} />
      <AISettings token={token} toast={toast} onChanged={onAiChanged} />
      <ThemeEditor token={token} clinic={clinic} onSaved={(next) => setClinic(next)} />
      <ActivityLogPanel token={token} />
    </Box>
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialogs + detail (real)
// ---------------------------------------------------------------------------
/** Admin-only clinic logo upload. The logo is printed on prescriptions and receipts. */
function ClinicLogoUploader({ token, clinic, onChanged }: { token: string; clinic: ClinicSettingRow | null; onChanged: (clinic: ClinicSettingRow) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logoRevision, setLogoRevision] = useState(0);
  useLiveRefresh(() => { setLogoRevision((value) => value + 1); });

  useEffect(() => {
    if (!file) { setFilePreview(null); return; }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!clinic?.logo_path) { setPreview(null); return; }
    let url: string | null = null;
    let alive = true;
    clinicApi.logoBlob(token)
      .then((blob) => { url = URL.createObjectURL(blob); if (alive) setPreview(url); else URL.revokeObjectURL(url); })
      .catch(() => { if (alive) setPreview(null); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [token, clinic?.logo_path, logoRevision]);

  const upload = async () => {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const res = await clinicApi.uploadLogo(token, file);
      const updated = unwrap<ClinicSettingRow>(res as unknown as { data: ClinicSettingRow });
      onChanged(updated);
      setFile(null);
      window.dispatchEvent(new CustomEvent(CLINIC_LOGO_EVENT, { detail: { hasLogo: Boolean(updated.logo_path) } }));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not upload the logo."); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setError("");
    try {
      const res = await clinicApi.deleteLogo(token);
      const updated = unwrap<ClinicSettingRow>(res as unknown as { data: ClinicSettingRow });
      onChanged(updated);
      window.dispatchEvent(new CustomEvent(CLINIC_LOGO_EVENT, { detail: { hasLogo: Boolean(updated.logo_path) } }));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not remove the logo."); }
    finally { setBusy(false); }
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2">Clinic logo</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
        Printed on prescriptions and receipts. JPG, PNG or WebP, up to 1 MB.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
      <Stack direction="row" spacing={2} alignItems="center">
        <Box sx={{ width: 84, height: 84, borderRadius: 2, border: 1, borderColor: "divider", display: "grid", placeItems: "center", overflow: "hidden", bgcolor: "background.paper" }}>
          {preview || filePreview
            ? <Box component="img" src={filePreview ?? preview ?? ""} alt="Clinic logo" sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            : <Typography variant="caption" color="text.secondary">No logo</Typography>}
        </Box>
        <Stack spacing={1}>
          <Button component="label" variant="outlined" disabled={busy}>
            {preview ? "Replace logo" : "Upload logo"}
            <input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(""); }} />
          </Button>
          {file && <Button size="small" variant="contained" disabled={busy} onClick={() => void upload()}>{busy ? "Uploading..." : "Save logo"}</Button>}
          {preview && !file && <Button size="small" color="warning" disabled={busy} onClick={() => void remove()}>Remove logo</Button>}
        </Stack>
      </Stack>
    </Box>
  );
}

function PatientDetailReal({ token, role, patient: initialPatient, onClose, onBook, onConsult, ai }: { token: string; role: UserRole; patient: PatientRow; onClose: () => void; onBook: () => void; onConsult?: (patient: PatientRow) => void; ai: AiStatus | null }) {
  const [patient, setPatient] = useState(initialPatient);
  const [visits, setVisits] = useState<Paginated<VisitRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [visitPage, setVisitPage] = useState(1);
  const [visitPerPage, setVisitPerPage] = useState(10);
  const [historyError, setHistoryError] = useState("");
  useLiveRefresh(async () => {
    const result = await patientApi.get(token, patient.id);
    setPatient((result as unknown as { data: PatientRow }).data);
    if (role !== "receptionist") {
      const history = await patientApi.visits(token, patient.id, { page: visitPage, per_page: visitPerPage });
      setVisits((history as unknown as { data: Paginated<VisitRow> }).data);
    }
  });
  useEffect(() => {
    if (role === "receptionist") { setLoading(false); return; }
    setLoading(true); setHistoryError("");
    patientApi.visits(token, patient.id, { page: visitPage, per_page: visitPerPage })
      .then((r) => setVisits((r as unknown as { data: Paginated<VisitRow> }).data))
      .catch((e: unknown) => setHistoryError(e instanceof Error ? e.message : "Could not load visit history."))
      .finally(() => setLoading(false));
  }, [token, patient.id, visitPage, visitPerPage, role]);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 2.5 }, pb: 1, fontWeight: 700 }}>
        Patient profile & history
      </DialogTitle>
      <DialogContent sx={{ px: { xs: 2, sm: 3 }, py: 1.5, minWidth: 0 }}>
        <Box className="patient-summary" sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, alignItems: { xs: "flex-start", sm: "center" }, gap: 2, mt: 1, minWidth: 0, width: "100%" }}>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ width: "100%", minWidth: 0 }}>
            <Avatar className="large-avatar">{initials(patientDisplay(patient))}</Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography component="h2" variant="h6" sx={{ overflowWrap: "anywhere", wordBreak: "break-word", lineHeight: 1.25 }}>
                {patientDisplay(patient)}
              </Typography>
              <Typography variant="body2" color="text.secondary" className="mono" sx={{ mt: 0.25 }}>
                Patient ID: {patient.patient_number}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere", mt: 0.25 }}>
                {[patient.phone, patient.sex ? (patient.sex.charAt(0).toUpperCase() + patient.sex.slice(1)) : null, patient.date_of_birth ? `DOB ${String(patient.date_of_birth).slice(0, 10)}` : null].filter(Boolean).join(" • ")}
              </Typography>
              {patient.email && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere", wordBreak: "break-all" }}>
                  {patient.email}
                </Typography>
              )}
            </Box>
          </Stack>

          <Box sx={{ width: "100%", minWidth: 0, mt: { xs: 1, sm: 0 }, display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center", justifyContent: "space-between" }}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="caption" sx={{ display: "block", color: "text.secondary", fontWeight: 700, textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.5px" }}>
                Allergies
              </Typography>
              {patient.allergies_summary ? (
                <Chip
                  sx={{
                    mt: 0.5,
                    height: "auto",
                    maxWidth: "100%",
                    py: 0.5,
                    "& .MuiChip-label": {
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                      px: 1,
                    },
                  }}
                  label={patient.allergies_summary}
                  color="warning"
                  variant="outlined"
                />
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  No known allergies recorded
                </Typography>
              )}
            </Box>
            <Stack direction="row" spacing={1} sx={{ width: { xs: "100%", sm: "auto" }, mt: { xs: 1, sm: 0 } }}>
              <WhatsAppButton
                variant="button"
                phone={patient.phone}
                message={generalMessage(patient, getClinicDetails().name)}
                patientName={patientDisplay(patient)}
                label="WhatsApp"
              />
              {(role === "doctor" || role === "admin") && onConsult && (
                <Button variant="contained" size="small" startIcon={<IconClipboardHeart size={16} />} onClick={() => { onClose(); onConsult(patient); }}>
                  Start consultation
                </Button>
              )}
              {role !== "doctor" && (
                <Button variant={role === "admin" ? "outlined" : "contained"} size="small" startIcon={<IconCalendarPlus size={16} />} onClick={onBook}>
                  Book follow-up
                </Button>
              )}
            </Stack>
          </Box>
        </Box>

        <AiPatientSummary token={token} ai={ai} patient={patient} />

        <Divider sx={{ my: 2 }} />
        <Typography component="h3" variant="h6" sx={{ fontSize: "16px", fontWeight: 700, mb: 1 }}>
          {role === "receptionist" ? "Appointment history" : "Visit history"}
        </Typography>
        {loading && <Box sx={{ py: 2 }}><CircularProgress size={20} /></Box>}
        {historyError && <Alert severity="error" sx={{ mb: 1.5 }}>{historyError}</Alert>}
        {role === "receptionist" && <Typography variant="body2" color="text.secondary">Clinical notes are available to authorized clinical staff.</Typography>}
        {!loading && role !== "receptionist" && (visits?.data.length ?? 0) === 0 && <Typography color="text.secondary" sx={{ py: 2 }}>No visits recorded yet.</Typography>}
        {(visits?.data ?? []).map((v) => (
          <Box className="history-item" key={v.id} sx={{ py: 1.5, borderBottom: "1px solid #edf1ef", minWidth: 0 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 0.5, minWidth: 0 }}>
              <Typography fontWeight={700} variant="body2">
                {String(v.visit_date).slice(0, 10)} {v.visit_number ? `(${v.visit_number})` : ""}
              </Typography>
              <Chip label={v.status} size="small" color={v.status === "amended" ? "info" : v.status === "finalized" ? "success" : "warning"} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, overflowWrap: "anywhere", wordBreak: "break-word" }}>
              {v.doctor?.display_name ?? "Doctor"}{v.diagnosis ? ` — ${v.diagnosis}` : " — No diagnosis recorded"}
            </Typography>
            {(v.treatment_plan || v.symptoms) && (
              <Typography variant="body2" sx={{ mt: 0.75, overflowWrap: "anywhere", wordBreak: "break-word", color: "#374151" }}>
                {v.treatment_plan ?? v.symptoms}
              </Typography>
            )}
            {v.amendments && v.amendments.length > 0 && (
              <Box sx={{ mt: 1, p: 1.25, bgcolor: "#f6f9f8", borderRadius: 1.5, borderLeft: "3px solid #006874", minWidth: 0 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: "primary.main", display: "block", mb: 0.5 }}>
                  {v.amendments.length} audited amendment{v.amendments.length > 1 ? "s" : ""}:
                </Typography>
                {v.amendments.map((am) => (
                  <Typography key={am.id} variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere", wordBreak: "break-word", mt: 0.25 }}>
                    • [{am.reason}] {am.notes} ({istDateTime(am.created_at)})
                  </Typography>
                ))}
              </Box>
            )}
          </Box>
        ))}
        {visits && role !== "receptionist" && (
          <PagerBar
            page={visits.current_page}
            lastPage={visits.last_page}
            total={visits.total}
            perPage={visitPerPage}
            onPage={setVisitPage}
            onPerPage={(n) => { setVisitPerPage(n); setVisitPage(1); }}
          />
        )}
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 1.5 }}>
        <Button onClick={onClose} fullWidth variant="outlined">Close</Button>
      </DialogActions>
    </Dialog>
  );
}
function AppointmentDialogReal({ mode, patients, doctors, token, onClose, onSaved }: {
  mode: AppointmentRow | "walk-in" | "appointment"; patients: PatientRow[]; doctors: DoctorRow[]; token: string; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const existing = typeof mode === "object" ? mode : null;
  const [patientId, setPatientId] = useState<string>(existing ? String(existing.patient_id) : patients[0] ? String(patients[0].id) : "");
  const [doctorId, setDoctorId] = useState<string>(existing ? String(existing.doctor_id) : doctors[0] ? String(doctors[0].id) : "");
  const [date, setDate] = useState<string>(existing ? String(existing.appointment_date).slice(0, 10) : istDate());
  const [time, setTime] = useState(existing ? String(existing.start_time).slice(0, 5) : "10:00");
  const [endTime, setEndTime] = useState(existing?.end_time ? String(existing.end_time).slice(0, 5) : "");
  const [reason, setReason] = useState(existing?.reason_for_visit ?? "");
  const [patientSearch, setPatientSearch] = useState("");
  const [patientMatches, setPatientMatches] = useState<PatientRow[]>(patients);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const debouncedPatientSearch = useDebounced(patientSearch, 250);
  const patientOptions = Array.from(new Map([...patients, ...patientMatches].map((p) => [p.id, p])).values());
  const selectedPatient = patientOptions.find((p) => p.id === Number(patientId)) ?? null;
  useLiveRefresh(async () => {
    const result = await patientApi.list(token, { page: 1, per_page: 50, search: debouncedPatientSearch || undefined, sort: "first_name", direction: "asc" });
    setPatientMatches((result as unknown as { data: Paginated<PatientRow> }).data.data);
  });

  useEffect(() => {
    patientApi.list(token, { page: 1, per_page: 50, search: debouncedPatientSearch || undefined, sort: "first_name", direction: "asc" })
      .then((res) => setPatientMatches((res as unknown as { data: { data: PatientRow[] } }).data.data))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "Could not search patients."));
  }, [token, debouncedPatientSearch]);
  useEffect(() => {
    if (!existing || patientOptions.some((p) => p.id === existing.patient_id)) return;
    patientApi.get(token, existing.patient_id).then((res) => setPatientMatches((all) => [...all, (res as unknown as { data: PatientRow }).data])).catch(() => {});
  }, [existing, token, patientOptions]);
  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      if (existing) {
        await appointmentApi.update(token, existing.id, { doctor_id: Number(doctorId), appointment_date: date, start_time: time, end_time: endTime || undefined, reason_for_visit: reason || undefined });
      } else if (mode === "walk-in") {
        await appointmentApi.walkIn(token, { patient_id: Number(patientId), doctor_id: Number(doctorId), appointment_date: date, start_time: time, end_time: endTime || undefined, reason_for_visit: reason || undefined });
      } else {
        await appointmentApi.create(token, { patient_id: Number(patientId), doctor_id: Number(doctorId), appointment_date: date, start_time: time, end_time: endTime || undefined, reason_for_visit: reason || undefined });
      }
      await onSaved();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed to save appointment"); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm"><DialogTitle>{existing ? "Reschedule appointment" : mode === "walk-in" ? "Register walk-in" : "Book appointment"}</DialogTitle>
      <DialogContent>
        {err && <Alert severity="error" sx={{ mt: 1, mb: 1 }}>{err}</Alert>}
        <Autocomplete options={patientOptions} value={selectedPatient} getOptionLabel={(p) => `${patientDisplay(p)} (${p.patient_number})`} isOptionEqualToValue={(a, b) => a.id === b.id} onChange={(_, p) => setPatientId(p ? String(p.id) : "")} inputValue={patientSearch} onInputChange={(_, value) => setPatientSearch(value)} renderInput={(params) => <TextField {...params} label="Patient" placeholder="Search name, phone or patient ID" />} sx={{ mt: 1 }} />
        <TextField select fullWidth label="Doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} sx={{ mt: 2 }}>{doctors.map((d) => <MenuItem key={d.id} value={String(d.id)}>{d.display_name}</MenuItem>)}</TextField>
        <Box className="two-fields"><TextField type="date" label="Date" value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} /><TextField type="time" label="Start time" value={time} onChange={(e) => setTime(e.target.value)} InputLabelProps={{ shrink: true }} /></Box>
        <TextField type="time" label="End time (optional)" value={endTime} onChange={(e) => setEndTime(e.target.value)} InputLabelProps={{ shrink: true }} fullWidth sx={{ mt: 2 }} />
        <TextField fullWidth label="Reason for visit" value={reason} onChange={(e) => setReason(e.target.value)} sx={{ mt: 2 }} />
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Cancel</Button><Button variant="contained" disabled={!patientId || !doctorId || !time || busy} onClick={() => void submit()}>{busy ? <CircularProgress size={18} /> : existing ? "Save reschedule" : mode === "walk-in" ? "Register walk-in" : "Book appointment"}</Button></DialogActions>
    </Dialog>
  );
}
