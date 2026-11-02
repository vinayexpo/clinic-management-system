import { useEffect, useMemo, useState } from "react";
import {
  AppBar,
  Badge,
  Box,
  Button,
  Chip,
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
  Menu,
  MenuItem,
  Popover,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import {
  IconActivity,
  IconBell,
  IconBuildingHospital,
  IconCalendarEvent,
  IconCalendarPlus,
  IconCash,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClipboardHeart,
  IconClock,
  IconLogout,
  IconMapPin,
  IconPhone,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconStethoscope,
  IconUser,
  IconUserCheck,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { PersonAvatar } from "./common";
import { NotificationList, PushToggle } from "./NotificationParts";
import { openStatus, summarizeHours, type ClinicHours } from "./ClinicHours";
import { istCompactDate, istTime } from "../lib/ist";
import { notificationPage, relativeTime, useNotifications } from "../lib/notifications";
import type { Page } from "../navigation";
import type { ApiUser, AppointmentRow, PatientRow } from "../api";

export interface TopBarProps {
  user: ApiUser;
  clinic: { name: string; hours: ClinicHours | null; address?: string | null; phone?: string | null };
  page: Page;
  setPage: (p: Page) => void;
  waitingCount: number;
  todayApptsCount: number;
  token: string;
  onQuickBook: () => void;
  onQuickWalkIn: () => void;
  onLogout: () => void;
  onEditProfile: () => void;
  logoUrl?: string | null;
  patients?: PatientRow[];
  appts?: AppointmentRow[];
  onSelectPatient?: (p: PatientRow) => void;
  /** The clinic assistant opens from here once an administrator has configured AI. */
  aiReady?: boolean;
  onOpenAssistant?: () => void;
}

interface NotificationIconProps {
  type: string;
  size?: number;
}

function NotificationIcon({ type, size = 18 }: NotificationIconProps) {
  if (type.startsWith("appointment")) return <IconCalendarEvent size={size} color="#0b6b68" />;
  if (type.startsWith("visit") || type.startsWith("prescription")) return <IconStethoscope size={size} color="#2e7d32" />;
  if (type.startsWith("invoice") || type.startsWith("payment")) return <IconCash size={size} color="#1565c0" />;
  return <IconBuildingHospital size={size} color="#1565c0" />;
}

function patientName(p: PatientRow): string {  return [p.first_name, p.last_name].filter(Boolean).join(" ") || `Patient #${p.id}`;
}

export function TopBar({
  user,
  clinic,
  page,
  setPage,
  waitingCount,
  todayApptsCount,
  token,
  onQuickBook,
  onQuickWalkIn,
  onLogout,
  onEditProfile,
  logoUrl = null,
  patients = [],
  appts = [],
  onSelectPatient,
  aiReady = false,
  onOpenAssistant,
}: TopBarProps) {
  const isMobile = useMediaQuery("(max-width:768px)");

  // Live clock updating every second
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Desktop Menu & Popover Anchors
  const [profileAnchor, setProfileAnchor] = useState<null | HTMLElement>(null);
  const profileOpen = Boolean(profileAnchor);

  // Separate anchors for Lounge vs Notifications
  const [loungeAnchor, setLoungeAnchor] = useState<null | HTMLElement>(null);
  const loungeOpen = Boolean(loungeAnchor);

  const [notifAnchor, setNotifAnchor] = useState<null | HTMLElement>(null);
  const notifOpen = Boolean(notifAnchor);

  // Mobile Bottom Sheets
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);
  const [mobileLoungeOpen, setMobileLoungeOpen] = useState(false);
  const [mobileNotifOpen, setMobileNotifOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Notification read states
  const notifications = useNotifications(token, user.role);
  const unreadCount = notifications.unread;

  // Live clinic status calculation
  const status = useMemo(() => openStatus(clinic.hours), [clinic.hours, now]);
  const hoursSummary = clinic.hours ? summarizeHours(clinic.hours) : "Hours not configured";

  // Friendly greeting based on hour in IST
  const greeting = useMemo(() => {
    const hour = parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(now),
      10
    );
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, [now]);

  // Role chip mapping
  const roleBadge = useMemo(() => {
    switch (user.role) {
      case "doctor":
        return { label: "Doctor", bg: "#e6f4ea", text: "#137333", border: "#ceead6" };
      case "admin":
        return { label: "Administrator", bg: "#e8f0fe", text: "#1a73e8", border: "#d2e3fc" };
      default:
        return { label: "Receptionist", bg: "#fef7e0", text: "#b06000", border: "#feefc3" };
    }
  }, [user.role]);

  // Patients currently in waiting lounge
  const waitingPatients = useMemo(() => {
    return appts.filter((a) => a.status === "waiting");
  }, [appts]);

  // Dynamic Clinic Notifications
  const markAllAsRead = () => {
    void notifications.markAllRead();
  };

  const handleNotificationClick = (notif: { id: string; page: string }) => {
    void notifications.markRead(notif.id);
    setNotifAnchor(null);
    setMobileNotifOpen(false);
    const target = notificationPage(notif.page, user.role);
    if (target) {
      setPage(target);
    }
  };

  // Filtered patients for Quick Search
  const filteredPatients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return patients.slice(0, 10);
    return patients
      .filter((p) => {
        const name = `${p.first_name} ${p.last_name || ""}`.toLowerCase();
        const phone = (p.phone || "").toLowerCase();
        const num = (p.patient_number || "").toLowerCase();
        return name.includes(q) || phone.includes(q) || num.includes(q);
      })
      .slice(0, 15);
  }, [patients, searchQuery]);

  // Open Lounge Trigger
  const handleOpenLounge = (e: React.MouseEvent<HTMLElement>) => {
    if (isMobile) {
      setMobileLoungeOpen(true);
    } else {
      setLoungeAnchor(e.currentTarget);
    }
  };

  // Open Notifications Bell Trigger
  const handleOpenNotif = (e: React.MouseEvent<HTMLElement>) => {
    if (isMobile) {
      setMobileNotifOpen(true);
    } else {
      setNotifAnchor(e.currentTarget);
    }
  };

  // Open Profile Trigger
  const handleOpenProfile = (e: React.MouseEvent<HTMLElement>) => {
    if (isMobile) {
      setMobileProfileOpen(true);
    } else {
      setProfileAnchor(e.currentTarget);
    }
  };

  return (
    <>
      <AppBar position="sticky" color="transparent" elevation={0} className="topbar-appbar">
        {/* ================================================================= */}
        {/* TIER 1: Main Header Bar                                            */}
        {/* ================================================================= */}
        <Toolbar className="topbar">
          {/* Desktop Left: Time ticker & Greeting */}
          <Box className="topbar-left desktop-only">
            <Box className="topbar-live-ticker">
              <Box className="ticker-badge">
                <IconClock size={14} className="ticker-icon" aria-hidden="true" />
                <Typography component="span" className="ticker-time">
                  {istTime(now)}
                </Typography>
                <span className="ticker-sep">·</span>
                <Typography component="span" className="ticker-date">
                  {istCompactDate(now)}
                </Typography>
              </Box>

              {/* Clinic status pill */}
              <Tooltip title="Click to view clinic operating schedule">
                <Button
                  size="small"
                  className={`topbar-status-pill ${status?.open ? "is-open" : "is-closed"}`}
                  onClick={() => setHoursOpen(true)}
                  aria-label="Clinic operating status"
                >
                  <span
                    className="live-dot"
                    style={{
                      background: status == null ? "#9aa0a6" : status.open ? "#34a853" : "#ea4335",
                      boxShadow: status?.open ? "0 0 0 3px rgba(52, 168, 83, 0.25)" : "none",
                    }}
                    aria-hidden="true"
                  />
                  <span className="status-pill-text">
                    {status == null ? "Hours info" : status.open ? `Open · until ${status.until}` : "Closed now"}
                  </span>
                </Button>
              </Tooltip>
            </Box>

            <Box className="topbar-greeting-wrap">
              <Typography variant="body2" className="topbar-greeting-text">
                {greeting},{" "}
                <Typography component="span" fontWeight={700} color="inherit">
                  {user.name}
                </Typography>
              </Typography>
            </Box>
          </Box>

          {/* Mobile Left: Brand mark, Clinic Name & Status Dot */}
          <Box className="topbar-mobile-brand mobile-only">
            <Box className={`mobile-brand-icon${logoUrl ? " mobile-brand-icon-logo" : ""}`} aria-hidden="true">
              {logoUrl ? <img src={logoUrl} alt="" /> : <IconStethoscope size={18} />}
            </Box>
            <Box className="mobile-brand-meta">
              <Typography className="mobile-brand-name">
                {clinic.name || "Carehaven"}
              </Typography>
              <Button
                size="small"
                className={`mobile-brand-status-chip ${status?.open ? "open" : "closed"}`}
                onClick={() => setHoursOpen(true)}
                aria-label="View clinic operating schedule"
              >
                <span
                  className="live-dot"
                  style={{
                    background: status == null ? "#9aa0a6" : status.open ? "#34a853" : "#ea4335",
                  }}
                  aria-hidden="true"
                />
                <span>{status == null ? "Hours" : status.open ? "Open" : "Closed"}</span>
              </Button>
            </Box>
          </Box>

          <Box sx={{ flex: 1 }} />

          {/* Right Section: Quick actions, Search, Lounge, Bell & Profile */}
          <Stack direction="row" spacing={{ xs: 0.75, sm: 1 }} alignItems="center" className="topbar-right">
            {/* Desktop Quick Actions */}
            <Box className="topbar-quick-actions desktop-only">
              {user.role === "doctor" ? (
                <Button
                  variant="outlined"
                  size="small"
                  color="primary"
                  className="topbar-quick-btn"
                  startIcon={<IconClipboardHeart size={16} />}
                  onClick={() => setPage("Consultation")}
                >
                  Consultation
                </Button>
              ) : (
                <>
                  <Button
                    variant="outlined"
                    size="small"
                    className="topbar-quick-btn"
                    startIcon={<IconCalendarPlus size={16} />}
                    onClick={onQuickBook}
                  >
                    Book visit
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    className="topbar-quick-btn primary"
                    startIcon={<IconUserCheck size={16} />}
                    onClick={onQuickWalkIn}
                  >
                    Walk-in
                  </Button>
                </>
              )}

              {/* Waiting Lounge Button (Desktop & Tablet) */}
              <Tooltip title="View waiting lounge & queue">
                <Button
                  variant="outlined"
                  size="small"
                  className={`topbar-quick-btn lounge ${waitingCount > 0 ? "active" : ""}`}
                  startIcon={<IconUsers size={16} />}
                  onClick={handleOpenLounge}
                >
                  {waitingCount > 0 ? `${waitingCount} Waiting` : "Lounge"}
                </Button>
              </Tooltip>
            </Box>

            {/* Quick Patient Search Button */}
            <Tooltip title="Quick search patients">
              <IconButton
                size="small"
                className="topbar-action-icon-btn search-trigger-btn"
                aria-label="Quick search patients"
                onClick={() => setSearchOpen(true)}
              >
                <IconSearch size={19} />
              </IconButton>
            </Tooltip>

            {/* Clinic AI Assistant Button */}
            <Tooltip title={aiReady ? "Ask the clinic assistant" : "AI is not configured yet — an administrator can set it up in Settings"}>
              <IconButton
                size="small"
                className="topbar-action-icon-btn"
                aria-label="Open clinic AI assistant"
                disabled={!aiReady}
                onClick={onOpenAssistant}
              >
                <IconSparkles size={19} />
              </IconButton>
            </Tooltip>

            {/* Notification Bell (Dedicated to Clinic Alerts & Reminders) */}
            <Tooltip title="Clinic notifications & alerts">
              <IconButton
                size="small"
                className={`topbar-bell-btn ${unreadCount > 0 ? "has-queue" : ""}`}
                aria-label={`Clinic notifications: ${unreadCount} unread alerts`}
                onClick={handleOpenNotif}
              >
                <Badge badgeContent={unreadCount} color="error" max={99} overlap="circular">
                  <IconBell size={19} />
                </Badge>
              </IconButton>
            </Tooltip>

            {/* Desktop Divider */}
            <Divider orientation="vertical" flexItem className="desktop-only" sx={{ mx: 0.5, my: 1.5, borderColor: "#e2e8e5" }} />

            {/* User Profile Trigger Button */}
            <Button
              className={`topbar-profile-trigger ${profileOpen || mobileProfileOpen ? "is-active" : ""}`}
              onClick={handleOpenProfile}
              aria-expanded={profileOpen || mobileProfileOpen ? "true" : undefined}
              aria-haspopup="true"
              aria-label="User account menu"
            >
              <PersonAvatar
                token={token}
                endpoint={`/users/${user.id}/avatar`}
                name={user.name}
                hasAvatar={user.has_avatar}
                size={34}
                cacheKey={user.id}
              />
              <Box className="topbar-profile-info desktop-only">
                <Typography variant="body2" className="profile-name-text">
                  {user.name}
                </Typography>
                <span
                  className="profile-role-chip"
                  style={{
                    backgroundColor: roleBadge.bg,
                    color: roleBadge.text,
                    border: `1px solid ${roleBadge.border}`,
                  }}
                >
                  {roleBadge.label}
                </span>
              </Box>
              <IconChevronDown
                size={16}
                className={`profile-chevron desktop-only ${profileOpen ? "chevron-open" : ""}`}
                aria-hidden="true"
              />
            </Button>
          </Stack>
        </Toolbar>

        {/* ================================================================= */}
        {/* TIER 2: Mobile Interactive Quick-Action Ribbon                    */}
        {/* ================================================================= */}
        <Box className="topbar-mobile-ribbon mobile-only" role="region" aria-label="Quick clinic shortcuts">
          {/* Greeting & Time Chip */}
          <Box className="ribbon-chip-greeting">
            <IconClock size={13} style={{ color: "#0b6b68", flexShrink: 0 }} />
            <span className="ribbon-time-text">{istTime(now)}</span>
            <span className="ribbon-sep">·</span>
            <span className="ribbon-greeting-label">{greeting}, {user.name.split(" ")[0]}</span>
          </Box>

          {/* Quick Action Button: Book / Consultation */}
          {user.role === "doctor" ? (
            <Button
              size="small"
              className="ribbon-action-btn primary"
              startIcon={<IconClipboardHeart size={15} />}
              onClick={() => setPage("Consultation")}
            >
              Consultation
            </Button>
          ) : (
            <Button
              size="small"
              className="ribbon-action-btn primary"
              startIcon={<IconCalendarPlus size={15} />}
              onClick={onQuickBook}
            >
              + Book visit
            </Button>
          )}

          {/* Quick Action Button: Walk-in */}
          {user.role !== "doctor" && (
            <Button
              size="small"
              className="ribbon-action-btn secondary"
              startIcon={<IconUserCheck size={15} />}
              onClick={onQuickWalkIn}
            >
              + Walk-in
            </Button>
          )}

          {/* Waiting Lounge Pill (Specifically for Patient Queue) */}
          <Button
            size="small"
            className={`ribbon-action-btn lounge ${waitingCount > 0 ? "active" : ""}`}
            startIcon={<IconUsers size={15} />}
            onClick={() => setMobileLoungeOpen(true)}
          >
            {waitingCount > 0 ? `${waitingCount} Waiting` : "Lounge"}
          </Button>
        </Box>
      </AppBar>

      {/* =================================================================== */}
      {/* 1. Desktop Profile Menu                                             */}
      {/* =================================================================== */}
      {!isMobile && (
        <Menu
          anchorEl={profileAnchor}
          open={profileOpen}
          onClose={() => setProfileAnchor(null)}
          onClick={() => setProfileAnchor(null)}
          PaperProps={{ elevation: 4, className: "topbar-menu-card" }}
          transformOrigin={{ horizontal: "right", vertical: "top" }}
          anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        >
          <Box className="profile-menu-header">
            <PersonAvatar
              token={token}
              endpoint={`/users/${user.id}/avatar`}
              name={user.name}
              hasAvatar={user.has_avatar}
              size={44}
              cacheKey={user.id}
            />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="subtitle2" fontWeight={700} noWrap>
                {user.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" noWrap>
                {user.email}
              </Typography>
              <Chip
                size="small"
                label={roleBadge.label}
                sx={{
                  mt: 0.5,
                  height: 20,
                  fontSize: 10,
                  fontWeight: 700,
                  backgroundColor: roleBadge.bg,
                  color: roleBadge.text,
                  borderColor: roleBadge.border,
                }}
                variant="outlined"
              />
            </Box>
          </Box>

          <Divider sx={{ my: 1 }} />

          <MenuItem onClick={() => setPage("Dashboard")} selected={page === "Dashboard"}>
            <ListItemIcon><IconActivity size={18} /></ListItemIcon>
            <ListItemText primary="Dashboard overview" />
          </MenuItem>

          <MenuItem onClick={() => setPage("Appointments")} selected={page === "Appointments"}>
            <ListItemIcon><IconCalendarEvent size={18} /></ListItemIcon>
            <ListItemText primary="Appointments schedule" />
          </MenuItem>

          <MenuItem onClick={() => setPage("Patients")} selected={page === "Patients"}>
            <ListItemIcon><IconUser size={18} /></ListItemIcon>
            <ListItemText primary="Patient directory" />
          </MenuItem>

          {user.role === "doctor" && (
            <MenuItem onClick={() => setPage("Consultation")} selected={page === "Consultation"}>
              <ListItemIcon><IconStethoscope size={18} /></ListItemIcon>
              <ListItemText primary="Consultations" />
            </MenuItem>
          )}

          {user.role === "admin" && (
            <>
              <Divider sx={{ my: 0.5 }} />
              <MenuItem onClick={() => setPage("Staff")} selected={page === "Staff"}>
                <ListItemIcon><IconUsers size={18} /></ListItemIcon>
                <ListItemText primary="Staff management" />
              </MenuItem>
              <MenuItem onClick={() => setPage("Settings")} selected={page === "Settings"}>
                <ListItemIcon><IconSettings size={18} /></ListItemIcon>
                <ListItemText primary="Clinic settings" />
              </MenuItem>
            </>
          )}

          <Divider sx={{ my: 1 }} />

          <MenuItem onClick={onEditProfile}>
            <ListItemIcon><IconUser size={18} /></ListItemIcon>
            <ListItemText primary="My profile" secondary="Name, phone and photo" />
          </MenuItem>

          <MenuItem onClick={onLogout} className="menu-logout-item">
            <ListItemIcon><IconLogout size={18} color="#d32f2f" /></ListItemIcon>
            <ListItemText primary="Sign out" primaryTypographyProps={{ color: "error.main", fontWeight: 600 }} />
          </MenuItem>
        </Menu>
      )}

      {/* =================================================================== */}
      {/* 2. Desktop Waiting Lounge Popover (Triggered by 'Lounge' Button)    */}
      {/* =================================================================== */}
      {!isMobile && (
        <Popover
          anchorEl={loungeAnchor}
          open={loungeOpen}
          onClose={() => setLoungeAnchor(null)}
          PaperProps={{ elevation: 4, className: "topbar-lounge-popover" }}
          transformOrigin={{ horizontal: "right", vertical: "top" }}
          anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        >
          <Box className="notif-header">
            <Typography variant="subtitle2" fontWeight={700}>
              Waiting Lounge Queue
            </Typography>
            <Chip
              size="small"
              label={`${waitingPatients.length} Waiting`}
              color={waitingPatients.length > 0 ? "warning" : "default"}
              sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
            />
          </Box>

          <Box sx={{ p: 2, pt: 1 }}>
            {waitingPatients.length === 0 ? (
              <Box sx={{ py: 3, textAlign: "center", color: "text.secondary" }}>
                <IconUsers size={32} style={{ opacity: 0.4, marginBottom: 6 }} />
                <Typography variant="body2" fontWeight={600}>
                  Waiting lounge is clear
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  No patients are currently checked in and waiting.
                </Typography>
              </Box>
            ) : (
              <Box sx={{ maxHeight: 220, overflowY: "auto", mb: 1.5 }}>
                {waitingPatients.slice(0, 5).map((a) => (
                  <Box key={a.id} sx={{ p: 1, mb: 0.75, bgcolor: "#f7faf9", borderRadius: 1.5, border: "1px solid #e7eeeb" }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="body2" fontWeight={700}>
                        Token {a.token_number ?? "—"} · {a.patient ? `${a.patient.first_name} ${a.patient.last_name || ""}` : `Patient #${a.patient_id}`}
                      </Typography>
                      <Typography variant="caption" className="mono" color="text.secondary">
                        {String(a.start_time).slice(0, 5)}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {a.doctor?.display_name || "Doctor"} · {a.reason_for_visit || "General checkup"}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}

            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                fullWidth
                onClick={() => {
                  setLoungeAnchor(null);
                  setPage("Appointments");
                }}
              >
                Open Schedule
              </Button>
              {user.role === "doctor" && (
                <Button
                  size="small"
                  variant="outlined"
                  fullWidth
                  onClick={() => {
                    setLoungeAnchor(null);
                    setPage("Consultation");
                  }}
                >
                  Consultation
                </Button>
              )}
            </Stack>
          </Box>
        </Popover>
      )}

      {/* =================================================================== */}
      {/* 3. Desktop Notifications Popover (Triggered by Bell Icon)          */}
      {/* =================================================================== */}
      {!isMobile && (
        <Popover
          anchorEl={notifAnchor}
          open={notifOpen}
          onClose={() => setNotifAnchor(null)}
          PaperProps={{ elevation: 4, className: "topbar-notif-card" }}
          transformOrigin={{ horizontal: "right", vertical: "top" }}
          anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        >
          <Box className="notif-header">
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                Notifications
              </Typography>
              {unreadCount > 0 && (
                <Chip size="small" label={`${unreadCount} new`} color="error" sx={{ height: 18, fontSize: 10, fontWeight: 700 }} />
              )}
            </Box>
            {unreadCount > 0 && (
              <Button size="small" onClick={markAllAsRead} sx={{ fontSize: 11, textTransform: "none", minWidth: 0, p: 0.5 }}>
                Mark all read
              </Button>
            )}
          </Box>

          <Box className="notif-body">
            <NotificationList
              items={notifications.items}
              onSelect={handleNotificationClick}
              emptyHint="Booking changes, visits, and payments appear here."
            />
            {notifications.hasMore && (
              <Box sx={{ p: 1, textAlign: "center" }}>
                <Button size="small" onClick={() => void notifications.loadMore()} disabled={notifications.loadingMore} sx={{ fontSize: 12, textTransform: "none" }}>
                  {notifications.loadingMore ? "Loading..." : "Load older notifications"}
                </Button>
              </Box>
            )}
          </Box>

          <Divider />

          <Box sx={{ p: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
            {notifications.pushSupported ? (
              notifications.pushState === "subscribed" ? (
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => void notifications.disablePush()}
                  sx={{ fontSize: 12, textTransform: "none", color: "text.secondary" }}
                >
                  Turn off push alerts
                </Button>
              ) : (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => void notifications.enablePush()}
                  sx={{ fontSize: 12, textTransform: "none" }}
                >
                  Enable push alerts
                </Button>
              )
            ) : (
              <Typography variant="caption" color="text.secondary">
                Push alerts are not available in this browser.
              </Typography>
            )}
            <Button size="small" onClick={() => void notifications.refresh()} sx={{ fontSize: 12, textTransform: "none", minWidth: 0, p: 0.5 }}>
              Refresh
            </Button>
          </Box>
        </Popover>
      )}

      {/* =================================================================== */}
      {/* 4. Mobile Bottom Sheet: Notifications                               */}
      {/* =================================================================== */}
      <Drawer
        anchor="bottom"
        open={mobileNotifOpen}
        onClose={() => setMobileNotifOpen(false)}
        PaperProps={{ className: "mobile-action-sheet" }}
      >
        <Box className="mobile-sheet-content">
          <Box className="mobile-sheet-drag-handle" />
          <Box className="mobile-sheet-header">
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography variant="h6" fontWeight={700}>
                Notifications & Alerts
              </Typography>
              {unreadCount > 0 && (
                <Chip size="small" label={`${unreadCount} new`} color="error" sx={{ height: 20, fontSize: 10, fontWeight: 700 }} />
              )}
            </Box>
            <IconButton aria-label="Close notifications" onClick={() => setMobileNotifOpen(false)}>
              <IconX size={20} />
            </IconButton>
          </Box>

          {unreadCount > 0 && (
            <Box sx={{ px: 2, pb: 1, display: "flex", justifyContent: "flex-end" }}>
              <Button size="small" onClick={markAllAsRead} sx={{ fontSize: 12, textTransform: "none" }}>
                Mark all as read
              </Button>
            </Box>
          )}

          <Divider sx={{ mb: 1.5 }} />

          <Box className="mobile-sheet-scrollable-list" sx={{ maxHeight: "50vh" }}>
            <NotificationList
              items={notifications.items}
              onSelect={handleNotificationClick}
              emptyHint="Booking changes, visits, and payments appear here."
            />
            {notifications.hasMore && (
              <Box sx={{ p: 1, textAlign: "center" }}>
                <Button size="small" onClick={() => void notifications.loadMore()} disabled={notifications.loadingMore} sx={{ fontSize: 12, textTransform: "none" }}>
                  {notifications.loadingMore ? "Loading..." : "Load older notifications"}
                </Button>
              </Box>
            )}
          </Box>

          {notifications.pushSupported && (
            <>
              <Divider sx={{ my: 1.5 }} />
              <PushToggle
                supported
                subscribed={notifications.pushState === "subscribed"}
                pushState={notifications.pushState}
                busy={notifications.pushBusy}
                message={notifications.pushMessage}
                onEnable={() => void notifications.enablePush()}
                onDisable={() => void notifications.disablePush()}
                fullWidth
              />
            </>
          )}
        </Box>
      </Drawer>

      {/* =================================================================== */}
      {/* 5. Mobile Bottom Sheet: User Profile & Quick Navigation             */}
      {/* =================================================================== */}
      <Drawer
        anchor="bottom"
        open={mobileProfileOpen}
        onClose={() => setMobileProfileOpen(false)}
        PaperProps={{ className: "mobile-action-sheet" }}
      >
        <Box className="mobile-sheet-content">
          <Box className="mobile-sheet-drag-handle" />
          <Box className="mobile-sheet-user-card">
            <PersonAvatar
              token={token}
              endpoint={`/users/${user.id}/avatar`}
              name={user.name}
              hasAvatar={user.has_avatar}
              size={52}
              cacheKey={user.id}
            />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="h6" fontWeight={700} noWrap>
                {user.name}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {user.email}
              </Typography>
              <Chip
                size="small"
                label={roleBadge.label}
                sx={{
                  mt: 0.5,
                  height: 22,
                  fontSize: 11,
                  fontWeight: 700,
                  backgroundColor: roleBadge.bg,
                  color: roleBadge.text,
                  borderColor: roleBadge.border,
                }}
                variant="outlined"
              />
            </Box>
            <IconButton aria-label="Close" onClick={() => setMobileProfileOpen(false)}>
              <IconX size={20} />
            </IconButton>
          </Box>

          <Divider sx={{ my: 1.5 }} />

          <Typography variant="caption" sx={{ px: 2, fontWeight: 700, letterSpacing: 0.8, color: "text.secondary" }}>
            NAVIGATION
          </Typography>

          <List sx={{ py: 0.5 }}>
            <ListItem disablePadding>
              <ListItemButton onClick={() => { setMobileProfileOpen(false); setPage("Dashboard"); }} selected={page === "Dashboard"}>
                <ListItemIcon><IconActivity size={20} color="#0b6b68" /></ListItemIcon>
                <ListItemText primary="Dashboard" secondary="Daily statistics and queue summary" />
                <IconChevronRight size={18} color="#8a9b98" />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding>
              <ListItemButton onClick={() => { setMobileProfileOpen(false); setPage("Appointments"); }} selected={page === "Appointments"}>
                <ListItemIcon><IconCalendarEvent size={20} color="#0b6b68" /></ListItemIcon>
                <ListItemText primary="Appointments schedule" secondary="Manage bookings and check-ins" />
                <IconChevronRight size={18} color="#8a9b98" />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding>
              <ListItemButton onClick={() => { setMobileProfileOpen(false); setPage("Patients"); }} selected={page === "Patients"}>
                <ListItemIcon><IconUser size={20} color="#0b6b68" /></ListItemIcon>
                <ListItemText primary="Patient records" secondary="Search, view profiles & histories" />
                <IconChevronRight size={18} color="#8a9b98" />
              </ListItemButton>
            </ListItem>

            {user.role === "doctor" && (
              <ListItem disablePadding>
                <ListItemButton onClick={() => { setMobileProfileOpen(false); setPage("Consultation"); }} selected={page === "Consultation"}>
                  <ListItemIcon><IconStethoscope size={20} color="#0b6b68" /></ListItemIcon>
                  <ListItemText primary="Consultations" secondary="Record vitals, diagnosis & prescriptions" />
                  <IconChevronRight size={18} color="#8a9b98" />
                </ListItemButton>
              </ListItem>
            )}

            {user.role === "admin" && (
              <>
                <ListItem disablePadding>
                  <ListItemButton onClick={() => { setMobileProfileOpen(false); setPage("Staff"); }} selected={page === "Staff"}>
                    <ListItemIcon><IconUsers size={20} color="#0b6b68" /></ListItemIcon>
                    <ListItemText primary="Staff management" secondary="Accounts and doctor schedules" />
                    <IconChevronRight size={18} color="#8a9b98" />
                  </ListItemButton>
                </ListItem>
                <ListItem disablePadding>
                  <ListItemButton onClick={() => { setMobileProfileOpen(false); setPage("Settings"); }} selected={page === "Settings"}>
                    <ListItemIcon><IconSettings size={20} color="#0b6b68" /></ListItemIcon>
                    <ListItemText primary="Clinic settings" secondary="Working hours, prefixes & audits" />
                    <IconChevronRight size={18} color="#8a9b98" />
                  </ListItemButton>
                </ListItem>
              </>
            )}
          </List>

          <Divider sx={{ my: 1.5 }} />

          <List disablePadding>
            <ListItem disablePadding>
              <ListItemButton onClick={() => { setMobileProfileOpen(false); onEditProfile(); }}>
                <ListItemIcon><IconUser size={20} color="#0b6b68" /></ListItemIcon>
                <ListItemText primary="My profile" secondary="Name, phone and photo" />
                <IconChevronRight size={18} color="#8a9b98" />
              </ListItemButton>
            </ListItem>
          </List>

          <Box sx={{ px: 2, pb: 1 }}>
            <Button
              fullWidth
              variant="outlined"
              color="error"
              size="large"
              startIcon={<IconLogout size={18} />}
              onClick={onLogout}
              sx={{ borderRadius: 2.5, minHeight: 46, fontWeight: 700 }}
            >
              Sign out of Carehaven
            </Button>
          </Box>
        </Box>
      </Drawer>

      {/* =================================================================== */}
      {/* 6. Mobile Bottom Sheet: Waiting Room & Lounge                       */}
      {/* =================================================================== */}
      <Drawer
        anchor="bottom"
        open={mobileLoungeOpen}
        onClose={() => setMobileLoungeOpen(false)}
        PaperProps={{ className: "mobile-action-sheet" }}
      >
        <Box className="mobile-sheet-content">
          <Box className="mobile-sheet-drag-handle" />
          <Box className="mobile-sheet-header">
            <Box>
              <Typography variant="h6" fontWeight={700}>
                Waiting lounge
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {waitingPatients.length} patient{waitingPatients.length === 1 ? "" : "s"} waiting for consultation
              </Typography>
            </Box>
            <IconButton aria-label="Close" onClick={() => setMobileLoungeOpen(false)}>
              <IconX size={20} />
            </IconButton>
          </Box>

          <Divider sx={{ my: 1.5 }} />

          {waitingPatients.length === 0 ? (
            <Box sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>
              <IconUsers size={40} style={{ opacity: 0.4, marginBottom: 8 }} />
              <Typography variant="body1" fontWeight={600}>
                Lounge is currently clear
              </Typography>
              <Typography variant="body2" color="text.secondary">
                No checked-in patients are waiting in the lounge right now.
              </Typography>
            </Box>
          ) : (
            <Box className="mobile-sheet-scrollable-list">
              {waitingPatients.map((a) => (
                <Box key={a.id} className="mobile-lounge-item-card">
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 0.75 }}>
                    <Box>
                      <Chip
                        size="small"
                        label={`Token ${a.token_number ?? "—"}`}
                        color="warning"
                        sx={{ fontWeight: 700, mr: 1, height: 22 }}
                      />
                      <Typography component="span" fontWeight={700} variant="body1">
                        {a.patient ? `${a.patient.first_name} ${a.patient.last_name || ""}` : `Patient #${a.patient_id}`}
                      </Typography>
                    </Box>
                    <Typography variant="caption" className="mono" color="text.secondary">
                      {String(a.start_time).slice(0, 5)}
                    </Typography>
                  </Box>

                  <Typography variant="caption" color="text.secondary" display="block">
                    Assigned: {a.doctor?.display_name || "Doctor on duty"}
                  </Typography>
                  {a.reason_for_visit && (
                    <Typography variant="body2" sx={{ mt: 0.5, fontStyle: "italic", color: "#3c504d" }}>
                      "{a.reason_for_visit}"
                    </Typography>
                  )}

                  <Box sx={{ mt: 1.5, display: "flex", gap: 1 }}>
                    {user.role === "doctor" ? (
                      <Button
                        size="small"
                        variant="contained"
                        fullWidth
                        startIcon={<IconStethoscope size={16} />}
                        onClick={() => {
                          setMobileLoungeOpen(false);
                          setPage("Consultation");
                        }}
                      >
                        Start visit
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="outlined"
                        fullWidth
                        onClick={() => {
                          setMobileLoungeOpen(false);
                          setPage("Appointments");
                        }}
                      >
                        Manage in schedule
                      </Button>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
            <Button
              fullWidth
              variant="contained"
              size="medium"
              onClick={() => {
                setMobileLoungeOpen(false);
                setPage("Appointments");
              }}
              sx={{ borderRadius: 2 }}
            >
              View all today's appointments
            </Button>
          </Box>
        </Box>
      </Drawer>

      {/* =================================================================== */}
      {/* 7. Quick Patient Search Sheet (Mobile & Accessible)                 */}
      {/* =================================================================== */}
      <Drawer
        anchor="bottom"
        open={searchOpen}
        onClose={() => { setSearchOpen(false); setSearchQuery(""); }}
        PaperProps={{ className: "mobile-action-sheet search-sheet" }}
      >
        <Box className="mobile-sheet-content">
          <Box className="mobile-sheet-drag-handle" />
          <Box className="mobile-sheet-header">
            <Typography variant="h6" fontWeight={700}>
              Quick patient search
            </Typography>
            <IconButton aria-label="Close search" onClick={() => { setSearchOpen(false); setSearchQuery(""); }}>
              <IconX size={20} />
            </IconButton>
          </Box>

          <Box sx={{ px: 2, py: 1 }}>
            <TextField
              fullWidth
              autoFocus
              placeholder="Search by name, phone or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <IconSearch size={18} color="#0b6b68" />
                  </InputAdornment>
                ),
                endAdornment: searchQuery ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSearchQuery("")}>
                      <IconX size={16} />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  borderRadius: 2.5,
                  bgcolor: "#ffffff",
                },
              }}
            />
          </Box>

          <Box className="mobile-sheet-scrollable-list" sx={{ maxHeight: "45vh" }}>
            {filteredPatients.length === 0 ? (
              <Box sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>
                <Typography variant="body2">No patients found matching "{searchQuery}"</Typography>
              </Box>
            ) : (
              <List disablePadding>
                {filteredPatients.map((p) => (
                  <ListItem key={p.id} disablePadding sx={{ borderBottom: "1px solid #edf2f0" }}>
                    <ListItemButton
                      onClick={() => {
                        setSearchOpen(false);
                        setSearchQuery("");
                        if (onSelectPatient) {
                          onSelectPatient(p);
                        } else {
                          setPage("Patients");
                        }
                      }}
                      sx={{ py: 1.25, px: 2 }}
                    >
                      <PersonAvatar
                        token={token}
                        endpoint={`/patients/${p.id}/avatar`}
                        name={patientName(p)}
                        hasAvatar={p.has_avatar}
                        size={40}
                        cacheKey={p.updated_at}
                      />
                      <Box sx={{ ml: 1.5, flex: 1, minWidth: 0 }}>
                        <Typography variant="body1" fontWeight={700} noWrap>
                          {patientName(p)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block">
                          ID: {p.patient_number} · Phone: {p.phone || "None"}
                        </Typography>
                      </Box>
                      <IconChevronRight size={18} color="#8a9b98" />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </Box>
      </Drawer>

      {/* =================================================================== */}
      {/* 8. Clinic Operating Schedule Modal / Sheet                          */}
      {/* =================================================================== */}
      <Dialog
        open={hoursOpen}
        onClose={() => setHoursOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3, m: 2 } }}
      >
        <DialogTitle sx={{ pb: 1, display: "flex", alignItems: "center", gap: 1 }}>
          <IconBuildingHospital size={24} color="#0b6b68" />
          <Box>
            <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
              {clinic.name || "Carehaven Clinic"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Operating hours & contact
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <span
                className="live-dot"
                style={{
                  background: status?.open ? "#34a853" : "#ea4335",
                  boxShadow: status?.open ? "0 0 0 3px rgba(52, 168, 83, 0.25)" : "none",
                }}
              />
              <Typography variant="subtitle2" fontWeight={700}>
                {status == null ? "Hours not configured" : status.open ? `Currently Open (until ${status.until})` : "Currently Closed"}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {hoursSummary}
            </Typography>
          </Box>

          {clinic.phone && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <IconPhone size={16} color="#0b6b68" />
              <Typography variant="body2">
                <a href={`tel:${clinic.phone}`} style={{ color: "#0b6b68", textDecoration: "none", fontWeight: 600 }}>
                  {clinic.phone} (Tap to call)
                </a>
              </Typography>
            </Box>
          )}

          {clinic.address && (
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 1.5 }}>
              <IconMapPin size={16} color="#0b6b68" style={{ marginTop: 2, flexShrink: 0 }} />
              <Typography variant="body2" color="text.secondary">
                {clinic.address}
              </Typography>
            </Box>
          )}

          {user.role === "admin" && (
            <Button
              size="small"
              variant="outlined"
              fullWidth
              startIcon={<IconSettings size={16} />}
              onClick={() => {
                setHoursOpen(false);
                setPage("Settings");
              }}
              sx={{ mt: 1 }}
            >
              Configure hours in Settings
            </Button>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHoursOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
