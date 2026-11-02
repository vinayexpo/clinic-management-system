import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from "@mui/material";
import { IconBell, IconBuildingHospital, IconCalendarEvent, IconCash, IconChevronRight, IconStethoscope } from "@tabler/icons-react";
import type { NotificationRow } from "../api";
import { relativeTime } from "../lib/notifications";
import type { PushState } from "../lib/push";

export function NotificationTypeIcon({ type, size = 18 }: { type: string; size?: number }) {
  if (type.startsWith("appointment")) return <IconCalendarEvent size={size} color="#0b6b68" />;
  if (type.startsWith("visit") || type.startsWith("prescription")) return <IconStethoscope size={size} color="#2e7d32" />;
  if (type.startsWith("invoice") || type.startsWith("payment")) return <IconCash size={size} color="#1565c0" />;
  return <IconBuildingHospital size={size} color="#1565c0" />;
}

/** The list of notifications, shared by the staff top bar and the patient portal. */
export function NotificationList({ items, onSelect, emptyHint }: {
  items: NotificationRow[];
  onSelect: (item: NotificationRow) => void;
  emptyHint?: string;
}) {
  if (items.length === 0) {
    return (
      <Box sx={{ py: 3, textAlign: "center", color: "text.secondary" }}>
        <IconBell size={30} style={{ opacity: 0.4, marginBottom: 6 }} />
        <Typography variant="body2">No notifications right now.</Typography>
        {emptyHint && <Typography variant="caption" color="text.secondary">{emptyHint}</Typography>}
      </Box>
    );
  }

  return (
    <List disablePadding>
      {items.map((n) => {
        const isRead = !!n.read_at;
        return (
          <ListItem
            key={n.id}
            disablePadding
            sx={{
              mb: 1,
              borderRadius: 2,
              bgcolor: isRead ? "#ffffff" : "#f2faf7",
              border: isRead ? "1px solid #edf2f0" : "1px solid #cce8e0",
            }}
          >
            <ListItemButton onClick={() => onSelect(n)} sx={{ p: 1.5 }}>
              <ListItemIcon sx={{ minWidth: 36 }}>
                <NotificationTypeIcon type={n.type} size={20} />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography variant="body2" fontWeight={isRead ? 600 : 700}>
                    {n.title}
                  </Typography>
                }
                secondary={
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
                    {n.body}
                  </Typography>
                }
              />
              <Box sx={{ textAlign: "right", flexShrink: 0 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  {relativeTime(n.created_at)}
                </Typography>
                <IconChevronRight size={18} color="#8a9b98" />
              </Box>
            </ListItemButton>
          </ListItem>
        );
      })}
    </List>
  );
}

/** Enables or disables browser push for the signed-in user. */
export function PushToggle({
  supported,
  subscribed,
  pushState,
  busy,
  message,
  onEnable,
  onDisable,
  fullWidth,
}: {
  supported: boolean;
  subscribed: boolean;
  pushState?: PushState;
  busy?: boolean;
  message?: string | null;
  onEnable: () => void;
  onDisable: () => void;
  fullWidth?: boolean;
}) {
  if (!supported) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 2, pb: 1.5 }}>
        Push alerts are not available in this browser or over an insecure connection.
      </Typography>
    );
  }

  const isDenied = pushState === "denied";

  return (
    <Box sx={{ px: 2, pb: 1.5 }}>
      {isDenied && (
        <Alert severity="warning" sx={{ mb: 1, py: 0.5, px: 1, fontSize: "0.75rem", borderRadius: 2 }}>
          Notifications are blocked in your browser. Click the lock icon in your address bar to allow permissions.
        </Alert>
      )}

      <Button
        fullWidth={fullWidth}
        size="medium"
        variant={subscribed ? "outlined" : "contained"}
        onClick={subscribed ? onDisable : onEnable}
        disabled={busy || isDenied}
        startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
        sx={{ borderRadius: 2.5, textTransform: "none", fontWeight: 500 }}
      >
        {busy
          ? subscribed
            ? "Turning off..."
            : "Enabling..."
          : subscribed
            ? "Turn off push alerts"
            : "Enable push alerts"}
      </Button>

      {message && (
        <Typography
          variant="caption"
          color={message.includes("blocked") || message.includes("Failed") ? "error" : "text.secondary"}
          sx={{ display: "block", mt: 0.75, fontSize: "0.75rem" }}
        >
          {message}
        </Typography>
      )}
    </Box>
  );
}

/** Compact bell used where the full staff top bar is not present. */
export function NotificationBellButton({ unread, onClick }: { unread: number; onClick: (event: React.MouseEvent<HTMLElement>) => void }) {
  return (
    <Tooltip title="Notifications">
      <IconButton
        size="small"
        className={`topbar-bell-btn ${unread > 0 ? "has-queue" : ""}`}
        aria-label={`Notifications: ${unread} unread`}
        onClick={onClick}
      >
        <IconBell size={19} />
        {unread > 0 && (
          <Box
            aria-hidden="true"
            sx={{
              position: "absolute",
              top: 2,
              right: 2,
              minWidth: 16,
              height: 16,
              px: 0.5,
              borderRadius: 8,
              backgroundColor: "#d32f2f",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              display: "grid",
              placeItems: "center",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </Box>
        )}
      </IconButton>
    </Tooltip>
  );
}
