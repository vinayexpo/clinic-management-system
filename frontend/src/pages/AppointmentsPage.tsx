import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  IconCalendar,
  IconCalendarPlus,
  IconChevronLeft,
  IconChevronRight,
  IconClipboardHeart,
  IconList,
  IconPlus,
} from "@tabler/icons-react";
import { appointmentApi, whatsappApi, type AppointmentRow, type DoctorRow, type Paginated, type UserRole } from "../api";
import { FilterSelect, PagerBar, SearchField, useDebounced } from "../components/common";
import { WhatsAppButton } from "../components/WhatsAppButton";
import { getClinicDetails } from "../lib/clinicStore";
import { appointmentMessage } from "../lib/whatsapp";
import { CLINIC_TZ, istDate, istLongDate } from "../lib/ist";
import { useLiveRefresh } from "../lib/realtime";

const statusColor = (status: AppointmentRow["status"]): "success" | "warning" | "error" | "info" | "default" => {
  if (status === "completed") return "success";
  if (status === "cancelled" || status === "no_show") return "error";
  if (status === "in_consultation") return "info";
  if (status === "waiting" || status === "booked") return "warning";
  return "default";
};

const nameOf = (a: AppointmentRow) =>
  a.patient ? [a.patient.first_name, a.patient.last_name].filter(Boolean).join(" ") : `Patient ${a.patient_id}`;

export function AppointmentsPage({
  token,
  role,
  doctors,
  refreshKey,
  onBook,
  onWalkIn,
  onEdit,
  onChanged,
  onConsult,
}: {
  token: string;
  role: UserRole;
  doctors: DoctorRow[];
  refreshKey: number;
  onBook: () => void;
  onWalkIn: () => void;
  onEdit: (appointment: AppointmentRow) => void;
  onChanged: () => void;
  onConsult?: (appointment: AppointmentRow) => void;
}) {
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [rows, setRows] = useState<Paginated<AppointmentRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [visitType, setVisitType] = useState("");
  const [dateMode, setDateMode] = useState<"today" | "range" | "all">("today");
  const [dateFrom, setDateFrom] = useState(istDate());
  const [dateTo, setDateTo] = useState(istDate());
  const [cancelTarget, setCancelTarget] = useState<AppointmentRow | null>(null);
  const [actionMenu, setActionMenu] = useState<{ anchor: HTMLElement; appointment: AppointmentRow } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const debouncedSearch = useDebounced(search);
  const canBook = role === "admin" || role === "receptionist";
  const canManage = canBook;

  // Visual Calendar State
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string>(() => istDate());
  const [calendarAppts, setCalendarAppts] = useState<AppointmentRow[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const listRequest = useRef(0);
  const calendarRequest = useRef(0);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, doctorId, visitType, dateMode, dateFrom, dateTo, perPage]);

  // Load appointments for List View
  const loadList = useCallback(async () => {
    const id = ++listRequest.current;
    setLoading(true);
    setError("");
    try {
      const result = await appointmentApi.list(token, {
        page,
        per_page: perPage,
        search: debouncedSearch || undefined,
        status: status || undefined,
        doctor_id: doctorId ? Number(doctorId) : undefined,
        visit_type: visitType || undefined,
        date: dateMode === "today" ? istDate() : "all",
        date_from: dateMode === "range" ? dateFrom : undefined,
        date_to: dateMode === "range" ? dateTo : undefined,
        sort: "start_time",
        direction: "asc",
      });
      if (id === listRequest.current) setRows((result as unknown as { data: Paginated<AppointmentRow> }).data);
    } catch (e: unknown) {
      if (id === listRequest.current) setError(e instanceof Error ? e.message : "Could not load appointments.");
    } finally {
      if (id === listRequest.current) setLoading(false);
    }
  }, [token, page, perPage, debouncedSearch, status, doctorId, visitType, dateMode, dateFrom, dateTo]);

  // Load appointments for Visual Calendar View (whole month)
  const loadCalendar = useCallback(async () => {
    const id = ++calendarRequest.current;
    setCalendarLoading(true);
    setError("");
    const yr = calendarMonth.getFullYear();
    const mo = calendarMonth.getMonth() + 1;
    const lastDay = new Date(yr, mo, 0).getDate();
    const mFrom = `${yr}-${String(mo).padStart(2, "0")}-01`;
    const mTo = `${yr}-${String(mo).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    try {
      const result = await appointmentApi.list(token, {
        date: "all",
        date_from: mFrom,
        date_to: mTo,
        doctor_id: doctorId ? Number(doctorId) : undefined,
        status: status || undefined,
        per_page: 100,
        sort: "start_time",
        direction: "asc",
      });
      const data = (result as unknown as { data: Paginated<AppointmentRow> }).data;
      if (id === calendarRequest.current) setCalendarAppts(data.data || []);
    } catch (e: unknown) {
      if (id === calendarRequest.current) setError(e instanceof Error ? e.message : "Could not load calendar appointments.");
    } finally {
      if (id === calendarRequest.current) setCalendarLoading(false);
    }
  }, [token, calendarMonth, doctorId, status]);

  useEffect(() => {
    if (viewMode === "list") {
      void loadList();
    } else {
      void loadCalendar();
    }
    return () => { ++listRequest.current; ++calendarRequest.current; };
  }, [viewMode, loadList, loadCalendar, refreshKey]);
  useLiveRefresh(async () => {
    await (viewMode === "list" ? loadList() : loadCalendar());
    if (actionMenu) {
      const { data } = await appointmentApi.get(token, actionMenu.appointment.id);
      setActionMenu((current) => current?.appointment.id === data.id ? { ...current, appointment: data } : current);
    }
    if (cancelTarget) {
      const { data } = await appointmentApi.get(token, cancelTarget.id);
      setCancelTarget((current) => current?.id === data.id ? data : current);
    }
  });

  const changeStatus = async (appointment: AppointmentRow, next: AppointmentRow["status"]) => {
    setActionError("");
    try {
      await appointmentApi.setStatus(token, appointment.id, next);
      onChanged();
      if (viewMode === "list") await loadList();
      else await loadCalendar();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Could not update appointment status.");
    }
  };

  const sendReminder = async (appointment: AppointmentRow) => {
    setActionError("");
    try {
      const res = await whatsappApi.remind(token, appointment.id);
      const data = (res as unknown as { data: { status: string; error: string | null } }).data;
      if (data.status === "failed" || data.status === "skipped") {
        setActionError(data.error ?? "The reminder could not be sent.");
      } else {
        setNotice(data.status === "logged" ? "Reminder recorded (log-only mode)" : "Reminder sent over WhatsApp");
      }
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "The reminder could not be sent.");
    }
  };

  const cancel = async () => {
    if (!cancelTarget) return;
    setActionError("");
    try {
      await appointmentApi.cancel(token, cancelTarget.id, cancelReason.trim());
      setCancelTarget(null);
      setCancelReason("");
      onChanged();
      if (viewMode === "list") await loadList();
      else await loadCalendar();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Could not cancel appointment.");
    }
  };

  const records = rows?.data ?? [];
  const dateLabel =
    dateMode === "today"
      ? `Today, ${istDate()}`
      : dateMode === "all"
      ? "All dates"
      : `${dateFrom} to ${dateTo}`;

  const rowActions = (a: AppointmentRow) => (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
      <WhatsAppButton
        variant="icon"
        phone={a.patient?.phone}
        message={appointmentMessage(a.patient, getClinicDetails().name, a)}
        patientName={a.patient ? [a.patient.first_name, a.patient.last_name].filter(Boolean).join(" ") : undefined}
        tooltip={`Send appointment details on WhatsApp to ${a.patient ? [a.patient.first_name, a.patient.last_name].filter(Boolean).join(" ") : "patient"}`}
      />
      {a.status === "booked" && role !== "doctor" && (
        <Button size="small" onClick={() => void changeStatus(a, "waiting")}>
          Check in
        </Button>
      )}
      {a.status === "waiting" && (
        <Button size="small" onClick={() => void changeStatus(a, "in_consultation")}>
          Call in
        </Button>
      )}
      {a.status === "in_consultation" && (
        <Button size="small" color="success" onClick={() => void changeStatus(a, "completed")}>
          Complete
        </Button>
      )}
      {onConsult && (role === "doctor" || role === "admin") && !["completed", "cancelled", "no_show"].includes(a.status) && (
        <Button
          size="small"
          variant="outlined"
          color="primary"
          startIcon={<IconClipboardHeart size={14} />}
          onClick={() => onConsult(a)}
        >
          Consult
        </Button>
      )}
      {canManage && !["completed", "cancelled", "no_show"].includes(a.status) && (
        <Button
          size="small"
          aria-label={`Actions for ${a.appointment_number}`}
          onClick={(e) => setActionMenu({ anchor: e.currentTarget, appointment: a })}
        >
          Actions
        </Button>
      )}
    </Stack>
  );

  // Month navigation helpers
  const prevMonth = () => {
    setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };
  const nextMonth = () => {
    setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };
  const goToday = () => {
    const today = new Date();
    setCalendarMonth(today);
    setSelectedDate(istDate(today));
  };

  // Build grid days for Month view
  const { monthLabel, calendarGrid } = useMemo(() => {
    const yr = calendarMonth.getFullYear();
    const mo = calendarMonth.getMonth();
    const firstDayIndex = new Date(yr, mo, 1).getDay();
    const daysInMo = new Date(yr, mo + 1, 0).getDate();
    const label = new Intl.DateTimeFormat("en-IN", {
      timeZone: CLINIC_TZ,
      month: "long",
      year: "numeric",
    }).format(new Date(yr, mo, 1));

    const grid: { dateStr: string; dayNum: number; isCurrentMonth: boolean }[] = [];

    // Preceding month filler days
    const prevMoDays = new Date(yr, mo, 0).getDate();
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dNum = prevMoDays - i;
      const prevMo = mo === 0 ? 12 : mo;
      const prevYr = mo === 0 ? yr - 1 : yr;
      const dateStr = `${prevYr}-${String(prevMo).padStart(2, "0")}-${String(dNum).padStart(2, "0")}`;
      grid.push({ dateStr, dayNum: dNum, isCurrentMonth: false });
    }

    // Days in current month
    for (let d = 1; d <= daysInMo; d++) {
      const dateStr = `${yr}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      grid.push({ dateStr, dayNum: d, isCurrentMonth: true });
    }

    // Trailing month filler days to complete 35 or 42 grid slots
    const totalSlots = grid.length <= 35 ? 35 : 42;
    let nextDay = 1;
    while (grid.length < totalSlots) {
      const nextMo = mo + 2 > 12 ? 1 : mo + 2;
      const nextYr = mo + 2 > 12 ? yr + 1 : yr;
      const dateStr = `${nextYr}-${String(nextMo).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`;
      grid.push({ dateStr, dayNum: nextDay, isCurrentMonth: false });
      nextDay++;
    }

    return { monthLabel: label, calendarGrid: grid };
  }, [calendarMonth]);

  // Appointments for the selected calendar date
  const selectedDayAppts = useMemo(() => {
    return calendarAppts.filter((a) => String(a.appointment_date).slice(0, 10) === selectedDate);
  }, [calendarAppts, selectedDate]);

  // Map of date string -> appointments array for fast cell lookup
  const apptsByDate = useMemo(() => {
    const map = new Map<string, AppointmentRow[]>();
    for (const a of calendarAppts) {
      const d = String(a.appointment_date).slice(0, 10);
      const list = map.get(d) ?? [];
      list.push(a);
      map.set(d, list);
    }
    return map;
  }, [calendarAppts]);

  const todayStr = istDate();

  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5} sx={{ mb: 2 }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.25}
            alignItems={{ sm: "center" }}
            justifyContent="space-between"
          >
            <Box>
              <Typography component="h2" variant="h5">
                Appointment schedule
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {viewMode === "list"
                  ? `${rows ? `${rows.total} appointments` : "Loading appointments"}, ${dateLabel}`
                  : `Visual calendar, ${monthLabel} (${calendarAppts.length} visits in month)`}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <ToggleButtonGroup
                value={viewMode}
                exclusive
                onChange={(_, v) => {
                  if (v) setViewMode(v);
                }}
                size="small"
                aria-label="Schedule view mode"
              >
                <ToggleButton value="list" aria-label="List view">
                  <IconList size={17} style={{ marginRight: 6 }} /> List
                </ToggleButton>
                <ToggleButton value="calendar" aria-label="Calendar view">
                  <IconCalendar size={17} style={{ marginRight: 6 }} /> Calendar
                </ToggleButton>
              </ToggleButtonGroup>
              {canBook && (
                <>
                  <Button variant="outlined" onClick={onWalkIn}>
                    Walk-in
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<IconCalendarPlus size={17} />}
                    onClick={onBook}
                  >
                    Book appointment
                  </Button>
                </>
              )}
            </Stack>
          </Stack>

          {/* Filters Bar */}
          <Box className="filter-toolbar">
            {viewMode === "list" && (
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder="Search patient, reason or appointment ID"
              />
            )}
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              width={160}
              options={[
                { value: "booked", label: "Booked" },
                { value: "waiting", label: "Waiting" },
                { value: "in_consultation", label: "In consultation" },
                { value: "completed", label: "Completed" },
                { value: "cancelled", label: "Cancelled" },
                { value: "no_show", label: "No show" },
              ]}
            />
            <FilterSelect
              label="Doctor"
              value={doctorId}
              onChange={setDoctorId}
              width={180}
              options={doctors.map((d) => ({ value: String(d.id), label: d.display_name }))}
            />
            {viewMode === "list" && (
              <>
                <FilterSelect
                  label="Visit type"
                  value={visitType}
                  onChange={setVisitType}
                  width={155}
                  options={[
                    { value: "appointment", label: "Appointment" },
                    { value: "walk_in", label: "Walk-in" },
                  ]}
                />
                <FilterSelect
                  label="Date"
                  value={dateMode}
                  onChange={(v) => setDateMode(v as typeof dateMode)}
                  width={145}
                  options={[
                    { value: "today", label: "Today" },
                    { value: "range", label: "Date range" },
                    { value: "all", label: "All dates" },
                  ]}
                />
                {dateMode === "range" && (
                  <>
                    <TextField
                      type="date"
                      label="From"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                    <TextField
                      type="date"
                      label="To"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                  </>
                )}
              </>
            )}
          </Box>
        </Stack>

        {(error || actionError) && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error || actionError}
          </Alert>
        )}
        {notice && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice("")}>
            {notice}
          </Alert>
        )}

        {/* ============================================================== */}
        {/* LIST VIEW                                                      */}
        {/* ============================================================== */}
        {viewMode === "list" && (
          <>
            {loading && !rows && (
              <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
                <CircularProgress />
              </Box>
            )}
            <Box
              className="desktop-data-table table-scroll"
              role="region"
              aria-label="Appointment records"
              tabIndex={0}
            >
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Token</TableCell>
                    <TableCell>Time</TableCell>
                    <TableCell>Patient</TableCell>
                    <TableCell>Visit</TableCell>
                    <TableCell>Doctor</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {records.map((a) => (
                    <TableRow key={a.id} hover>
                      <TableCell>
                        <Typography className="token">{a.token_number ?? "—"}</Typography>
                        <Typography variant="caption" className="mono">
                          {a.appointment_number}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {String(a.start_time).slice(0, 5)}
                        {a.end_time ? `–${String(a.end_time).slice(0, 5)}` : ""}
                      </TableCell>
                      <TableCell>
                        <Typography fontWeight={700}>{nameOf(a)}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {a.reason_for_visit || "No reason provided"}
                        </Typography>
                      </TableCell>
                      <TableCell>{a.visit_type === "walk_in" ? "Walk-in" : "Appointment"}</TableCell>
                      <TableCell>{a.doctor?.display_name ?? "—"}</TableCell>
                      <TableCell>
                        <Chip
                          label={a.status.replace(/_/g, " ")}
                          size="small"
                          color={statusColor(a.status)}
                        />
                      </TableCell>
                      <TableCell align="right">{rowActions(a)}</TableCell>
                    </TableRow>
                  ))}
                  {!loading && records.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Box sx={{ py: 3 }}>
                          <Typography fontWeight={700}>
                            No appointments match these filters.
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Change the search or date filters to see more.
                          </Typography>
                        </Box>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
            <Box className="mobile-record-list" aria-label="Appointment records">
              {!loading && records.length === 0 && (
                <Box className="mobile-record-card">
                  <Typography color="text.secondary">
                    No appointments match these filters.
                  </Typography>
                </Box>
              )}
              {records.map((a) => (
                <Box className="mobile-record-card" key={a.id}>
                  <Box className="mobile-record-main">
                    <Box>
                      <Typography className="mono">
                        Token {a.token_number ?? "—"}, {String(a.start_time).slice(0, 5)}
                      </Typography>
                      <Typography fontWeight={700}>{nameOf(a)}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {a.reason_for_visit || "No reason provided"}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      label={a.status.replace(/_/g, " ")}
                      color={statusColor(a.status)}
                    />
                  </Box>
                  <Box className="mobile-record-meta">
                    <span>Doctor</span>
                    <Typography variant="body2">{a.doctor?.display_name ?? "—"}</Typography>
                    <span>Type</span>
                    <Typography variant="body2">
                      {a.visit_type === "walk_in" ? "Walk-in" : "Appointment"}
                    </Typography>
                  </Box>
                  {rowActions(a)}
                </Box>
              ))}
            </Box>
            {rows && rows.total > 0 && (
              <PagerBar
                page={rows.current_page}
                lastPage={rows.last_page}
                total={rows.total}
                perPage={perPage}
                onPage={setPage}
                onPerPage={setPerPage}
              />
            )}
          </>
        )}

        {/* ============================================================== */}
        {/* VISUAL CALENDAR VIEW                                           */}
        {/* ============================================================== */}
        {viewMode === "calendar" && (
          <Box sx={{ mt: 1 }}>
            {/* Month Navigation Header */}
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{
                mb: 2,
                p: 1.5,
                bgcolor: "#f8faf9",
                borderRadius: 2,
                border: "1px solid #e5ece8",
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Tooltip title="Previous month">
                  <IconButton onClick={prevMonth} size="small" aria-label="Previous month">
                    <IconChevronLeft size={20} />
                  </IconButton>
                </Tooltip>
                <Typography variant="h6" fontWeight={700} sx={{ minWidth: 170 }}>
                  {monthLabel}
                </Typography>
                <Tooltip title="Next month">
                  <IconButton onClick={nextMonth} size="small" aria-label="Next month">
                    <IconChevronRight size={20} />
                  </IconButton>
                </Tooltip>
                <Button size="small" variant="outlined" onClick={goToday}>
                  Today
                </Button>
              </Stack>

              {calendarLoading && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={16} />
                  <Typography variant="caption" color="text.secondary">
                    Updating calendar...
                  </Typography>
                </Stack>
              )}
            </Stack>

            {/* Calendar Grid Container */}
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 1,
                mb: 3,
                overflowX: "auto",
                minWidth: 640,
              }}
            >
              {/* Day of Week Headers */}
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName) => (
                <Box
                  key={dayName}
                  sx={{
                    textAlign: "center",
                    py: 0.75,
                    fontWeight: 700,
                    fontSize: "0.825rem",
                    color: "text.secondary",
                    textTransform: "uppercase",
                  }}
                >
                  {dayName}
                </Box>
              ))}

              {/* Month Day Cells */}
              {calendarGrid.map((cell) => {
                const dayAppts = apptsByDate.get(cell.dateStr) || [];
                const isSelected = selectedDate === cell.dateStr;
                const isToday = todayStr === cell.dateStr;

                return (
                  <Box
                    key={cell.dateStr}
                    onClick={() => setSelectedDate(cell.dateStr)}
                    role="button"
                    tabIndex={0}
                    aria-label={`${cell.dateStr}, ${dayAppts.length} appointments`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setSelectedDate(cell.dateStr);
                      }
                    }}
                    sx={{
                      minHeight: 88,
                      p: 1,
                      borderRadius: 2,
                      cursor: "pointer",
                      border: isSelected
                        ? "2px solid #006874"
                        : "1px solid #e5ece8",
                      bgcolor: isSelected
                        ? "#f0f7f5"
                        : cell.isCurrentMonth
                        ? "#ffffff"
                        : "#fafbfa",
                      opacity: cell.isCurrentMonth ? 1 : 0.6,
                      transition: "all 0.15s ease",
                      "&:hover": {
                        bgcolor: isSelected ? "#e6f2ef" : "#f4f8f6",
                        borderColor: "#006874",
                      },
                    }}
                  >
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                      sx={{ mb: 0.5 }}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: isToday || isSelected ? 800 : 600,
                          color: isToday
                            ? "#006874"
                            : cell.isCurrentMonth
                            ? "text.primary"
                            : "text.disabled",
                          bgcolor: isToday ? "#e0f2f1" : "transparent",
                          px: isToday ? 0.75 : 0,
                          py: isToday ? 0.2 : 0,
                          borderRadius: 1,
                        }}
                      >
                        {cell.dayNum}
                      </Typography>
                      {dayAppts.length > 0 && (
                        <Chip
                          size="small"
                          label={dayAppts.length}
                          color={isSelected ? "primary" : "default"}
                          sx={{ height: 18, fontSize: "0.7rem", fontWeight: 700 }}
                        />
                      )}
                    </Stack>

                    {/* Preview top 2 appointments in cell */}
                    <Stack spacing={0.5}>
                      {dayAppts.slice(0, 2).map((a) => (
                        <Box
                          key={a.id}
                          sx={{
                            fontSize: "0.7rem",
                            px: 0.5,
                            py: 0.25,
                            borderRadius: 0.75,
                            bgcolor:
                              a.status === "completed"
                                ? "#e6f4ea"
                                : a.status === "in_consultation"
                                ? "#e8f0fe"
                                : a.status === "waiting"
                                ? "#fef7e0"
                                : "#f1f3f4",
                            color:
                              a.status === "completed"
                                ? "#137333"
                                : a.status === "in_consultation"
                                ? "#1a73e8"
                                : a.status === "waiting"
                                ? "#b06000"
                                : "#3c4043",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          <strong>{String(a.start_time).slice(0, 5)}</strong> {nameOf(a)}
                        </Box>
                      ))}
                      {dayAppts.length > 2 && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem", pl: 0.5 }}>
                          +{dayAppts.length - 2} more
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                );
              })}
            </Box>

            {/* Selected Date Schedule Inspector */}
            <Card variant="outlined" sx={{ borderRadius: 2, border: "1px solid #d8e3de" }}>
              <CardContent sx={{ p: 2.5 }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  justifyContent="space-between"
                  alignItems={{ sm: "center" }}
                  spacing={1}
                  sx={{ mb: 2, pb: 1.5, borderBottom: "1px solid #edf1ef" }}
                >
                  <Box>
                    <Typography component="h3" variant="h6" fontWeight={700}>
                      Schedule for {istLongDate(new Date(`${selectedDate}T00:00:00`))}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {selectedDayAppts.length} appointment
                      {selectedDayAppts.length !== 1 ? "s" : ""} booked for this date
                    </Typography>
                  </Box>
                  {canBook && (
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<IconPlus size={16} />}
                      onClick={onBook}
                    >
                      Book on this date
                    </Button>
                  )}
                </Stack>

                {selectedDayAppts.length === 0 && (
                  <Box sx={{ py: 4, textAlign: "center" }}>
                    <Typography color="text.secondary" sx={{ mb: 1 }}>
                      No appointments scheduled for this date.
                    </Typography>
                    {canBook && (
                      <Button variant="outlined" size="small" onClick={onBook}>
                        Schedule an appointment
                      </Button>
                    )}
                  </Box>
                )}

                {selectedDayAppts.length > 0 && (
                  <Stack spacing={1.5}>
                    {selectedDayAppts.map((a) => (
                      <Box
                        key={a.id}
                        sx={{
                          p: 1.5,
                          borderRadius: 2,
                          border: "1px solid #e5ece8",
                          bgcolor: "#ffffff",
                          display: "flex",
                          flexDirection: { xs: "column", md: "row" },
                          justifyContent: "space-between",
                          alignItems: { xs: "flex-start", md: "center" },
                          gap: 1.5,
                        }}
                      >
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <Box
                            sx={{
                              px: 1,
                              py: 0.5,
                              bgcolor: "#f0f4f2",
                              borderRadius: 1,
                              textAlign: "center",
                              minWidth: 60,
                            }}
                          >
                            <Typography variant="caption" sx={{ fontWeight: 800, color: "#006874" }}>
                              {String(a.start_time).slice(0, 5)}
                            </Typography>
                            {a.end_time && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: "0.65rem" }}>
                                {String(a.end_time).slice(0, 5)}
                              </Typography>
                            )}
                          </Box>

                          <Box>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="body1" fontWeight={700}>
                                {nameOf(a)}
                              </Typography>
                              {a.token_number != null && (
                                <Chip
                                  size="small"
                                  label={`Token #${a.token_number}`}
                                  variant="outlined"
                                  sx={{ height: 20, fontSize: "0.7rem" }}
                                />
                              )}
                              <Chip
                                size="small"
                                label={a.status.replace(/_/g, " ")}
                                color={statusColor(a.status)}
                              />
                            </Stack>
                            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
                              {a.doctor?.display_name ?? "Doctor"} • {a.visit_type === "walk_in" ? "Walk-in" : "Appointment"}
                              {a.reason_for_visit ? ` • ${a.reason_for_visit}` : ""}
                            </Typography>
                          </Box>
                        </Stack>

                        <Box sx={{ alignSelf: { xs: "flex-end", md: "center" } }}>
                          {rowActions(a)}
                        </Box>
                      </Box>
                    ))}
                  </Stack>
                )}
              </CardContent>
            </Card>
          </Box>
        )}

        <Menu
          anchorEl={actionMenu?.anchor}
          open={!!actionMenu}
          onClose={() => setActionMenu(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          {onConsult && (role === "doctor" || role === "admin") && actionMenu && !["completed", "cancelled", "no_show"].includes(actionMenu.appointment.status) && (
            <MenuItem
              onClick={() => {
                if (actionMenu) onConsult(actionMenu.appointment);
                setActionMenu(null);
              }}
            >
              Start consultation
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              if (actionMenu) onEdit(actionMenu.appointment);
              setActionMenu(null);
            }}
          >
            Reschedule appointment
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (actionMenu) void sendReminder(actionMenu.appointment);
              setActionMenu(null);
            }}
          >
            Send WhatsApp reminder
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (actionMenu) {
                setCancelTarget(actionMenu.appointment);
                setCancelReason("");
              }
              setActionMenu(null);
            }}
          >
            Cancel appointment
          </MenuItem>
        </Menu>

        <Dialog
          open={!!cancelTarget}
          onClose={() => setCancelTarget(null)}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>Cancel appointment</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              This cancellation will be recorded in the audit history.
            </Typography>
            <TextField
              fullWidth
              autoFocus
              label="Reason for cancellation"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            {actionError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {actionError}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCancelTarget(null)}>Keep appointment</Button>
            <Button
              variant="contained"
              color="error"
              disabled={!cancelReason.trim()}
              onClick={() => void cancel()}
            >
              Cancel appointment
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
}
