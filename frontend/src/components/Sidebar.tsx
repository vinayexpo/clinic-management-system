import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Box, Chip, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Typography,
} from "@mui/material";
import { IconActivity, IconChevronRight, IconStethoscope } from "@tabler/icons-react";
import { openStatus, summarizeHours, type ClinicHours } from "./ClinicHours";
import type { Page } from "../navigation";

export interface NavEntry {
  label: Page;
  icon: ReactNode;
}

interface SidebarProps {
  page: Page;
  navItems: NavEntry[];
  appointmentCount: number;
  setPage: (page: Page) => void;
  clinic: { name: string; hours: ClinicHours | null };
  logoUrl?: string | null;
}

/** Desktop clinic navigation; entry visibility is decided by the authenticated role. */
export function Sidebar({ page, navItems, appointmentCount, setPage, clinic, logoUrl }: SidebarProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const status = useMemo(() => openStatus(clinic.hours), [clinic.hours, tick]);
  const hoursText = clinic.hours ? summarizeHours(clinic.hours) : "Hours not set. Configure in Settings.";
  const adminPages: Page[] = ["Reports", "Staff", "Settings"];
  const clinicPages = navItems.filter((item) => !adminPages.includes(item.label));
  const adminNav = navItems.filter((item) => adminPages.includes(item.label));

  return (
    <Box className="sidebar" component="nav" aria-label="Primary navigation">
      <Box className="brand">
        {logoUrl
          ? <Box className="brand-mark brand-mark-logo" aria-hidden="true"><img src={logoUrl} alt="" /></Box>
          : <Box className="brand-mark" aria-hidden="true"><IconStethoscope size={21} /></Box>}
        <Box><Typography className="brand-name">{clinic.name || "Carehaven"}</Typography><Typography className="brand-sub">Clinic management</Typography></Box>
      </Box>
      <Box className="clinic-context"><Box className="clinic-context-icon" aria-hidden="true"><IconActivity size={16} /></Box><Box sx={{ minWidth: 0 }}><Typography variant="caption">TODAY AT A GLANCE</Typography><Typography variant="body2">{appointmentCount} appointments today</Typography></Box></Box>
      <Typography className="nav-label">CLINIC</Typography>
      <List className="nav-list">{clinicPages.map((item) => <SidebarItem key={item.label} item={item} page={page} setPage={setPage} appointmentCount={appointmentCount} />)}</List>
      {adminNav.length > 0 && <><Typography className="nav-label reports-label">ADMINISTRATION</Typography><List className="nav-list">{adminNav.map((item) => <SidebarItem key={item.label} item={item} page={page} setPage={setPage} appointmentCount={appointmentCount} />)}</List></>}
      <Box className="sidebar-bottom">
        <Box className="clinic-status-card">
          <Box className="status-heading"><span className="live-dot" style={{ background: status == null ? "#b0b8b6" : status.open ? "#4eae76" : "#c65853", boxShadow: "none" }} aria-hidden="true" /><Typography variant="caption">Clinic status</Typography></Box>
          <Typography variant="body2" fontWeight={700}>{status == null ? "Hours not set" : status.open ? `Open until ${status.until}` : "Closed now"}</Typography>
          <Typography variant="caption" color="text.secondary">{hoursText}</Typography>
        </Box>
        <Typography className="sidebar-version" variant="caption" color="text.secondary">{clinic.name || "Carehaven"}</Typography>
      </Box>
    </Box>
  );
}

function SidebarItem({ item, page, setPage, appointmentCount }: { item: NavEntry; page: Page; setPage: (page: Page) => void; appointmentCount: number }) {
  const selected = page === item.label;
  return (
    <ListItem disablePadding>
      <ListItemButton aria-label={`Navigate to ${item.label}`} selected={selected} aria-current={selected ? "page" : undefined} onClick={() => setPage(item.label)}>
        <ListItemIcon>{item.icon}</ListItemIcon>
        <ListItemText primary={item.label} />
        <Box className="nav-end">{item.label === "Appointments" && appointmentCount > 0 && <Chip label={appointmentCount} size="small" className="nav-count" aria-label={`${appointmentCount} appointments today`} />}{selected && item.label !== "Appointments" && <IconChevronRight className="nav-active-arrow" size={15} aria-hidden="true" />}</Box>
      </ListItemButton>
    </ListItem>
  );
}
