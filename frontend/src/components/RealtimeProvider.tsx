import { useEffect, useRef } from "react";
import { Alert, Box, Button } from "@mui/material";
import Echo from "laravel-echo";
import Pusher from "pusher-js";
import type { ChannelAuthorizationCallback } from "pusher-js";
import { useAuth } from "../AuthContext";
import { API_BASE } from "../api";
import { invalidateLiveData, setRealtimeSession, setRealtimeState, useRealtimeState } from "../lib/realtime";

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { token, user, refreshUser } = useAuth();
  const userId = user?.id;
  const role = user?.role;
  const state = useRealtimeState();
  const retryConnection = useRef<() => void>(() => {});

  useEffect(() => {
    if (!token || !userId) { setRealtimeSession(false); setRealtimeState("idle"); return; }
    let active = true;
    let terminalAuthorizationFailure = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    setRealtimeSession(true);
    setRealtimeState(navigator.onLine ? "connecting" : "offline");
    const secure = import.meta.env.VITE_REVERB_SCHEME === "https" ||
      (!import.meta.env.VITE_REVERB_SCHEME && location.protocol === "https:");
    const port = Number(import.meta.env.VITE_REVERB_PORT || (secure ? 443 : 8080));
    const echo = new Echo({
      broadcaster: "reverb",
      Pusher,
      key: import.meta.env.VITE_REVERB_APP_KEY || "clinic-local-key",
      wsHost: import.meta.env.VITE_REVERB_HOST || location.hostname,
      wsPort: port,
      wssPort: port,
      forceTLS: secure,
      enabledTransports: ["ws", "wss"],
      authorizer: (channel: { name: string }) => ({
        authorize: async (socketId: string, callback: ChannelAuthorizationCallback) => {
          try {
            const response = await fetch(new URL("../broadcasting/auth", new URL(`${API_BASE}/`, location.origin)).href, {
              method: "POST",
              signal: AbortSignal.timeout(10000),
              headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ socket_id: socketId, channel_name: channel.name }),
            });
            if (!active) return;
            if (response.status === 401 || response.status === 403) {
              terminalAuthorizationFailure = true;
              window.dispatchEvent(new CustomEvent("clinic:session-expired"));
            }
            if (!response.ok) throw new Error("Live connection authorization failed");
            callback(null, await response.json());
          } catch (error) {
            if (active) { setRealtimeState("reconnecting"); callback(error instanceof Error ? error : new Error("Live connection authorization failed"), null); }
          }
        },
      }),
    });
    const channel = echo.private(`users.${userId}`);
    const catchUp = () => {
      if (active && document.visibilityState !== "hidden") invalidateLiveData();
    };
    channel.listen(".application.invalidated", () => { if (active) invalidateLiveData(); });
    const connection = echo.connector.pusher.connection;
    const retry = () => {
      if (!active || terminalAuthorizationFailure) return;
      if (connection.state === "connected") {
        const subscription = echo.connector.pusher.subscribe(`private-users.${userId}`);
        if (subscription.subscribed) setRealtimeState("live");
      } else connection.connect();
    };
    retryConnection.current = retry;
    channel.subscribed(() => {
      if (active) {
        clearTimeout(retryTimer); retryTimer = undefined; retryAttempt = 0;
        setRealtimeState("live"); invalidateLiveData();
      }
    });
    channel.error(() => {
      if (!active || terminalAuthorizationFailure) return;
      setRealtimeState("reconnecting");
      if (!retryTimer) retryTimer = setTimeout(() => {
        retryTimer = undefined;
        retry();
      }, Math.min(1000 * 2 ** retryAttempt++, 30000));
    });
    connection.bind("state_change", ({ current }: { current: string }) => {
      if (active && current !== "connected") setRealtimeState(navigator.onLine ? "reconnecting" : "offline");
    });
    const online = () => { if (active) { setRealtimeState("reconnecting"); retry(); catchUp(); } };
    const offline = () => { if (active) setRealtimeState("offline"); };
    window.addEventListener("focus", catchUp);
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      active = false;
      clearTimeout(retryTimer);
      retryConnection.current = () => {};
      window.removeEventListener("focus", catchUp);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      echo.disconnect();
      setRealtimeSession(false);
      setRealtimeState("idle");
    };
  }, [token, userId, role]);

  useEffect(() => {
    if (!token) return;
    // Recheck identity on reconnect too, so role changes and deactivation cannot leave stale navigation.
    if (state === "live") void refreshUser();
  }, [state, token, refreshUser]);

  return <Box sx={{
    display: "flex", flexDirection: "column", height: token && user ? "100dvh" : undefined,
    "& > .app-frame": { flex: "1 1 0", height: "auto", minHeight: 0 },
    "& > .patient-portal-shell": { flex: "1 1 0", minHeight: 0, overflowY: "auto" },
  }}>
    {token && state !== "live" && state !== "idle" && <Box sx={{ px: { xs: 2, sm: 3 }, pt: 1, flexShrink: 0 }}>
      <Alert severity={state === "connecting" ? "info" : "warning"} role="status" sx={{
        p: 2, alignItems: "center",
        "& .MuiAlert-message": { p: 0 },
        "& .MuiAlert-icon": { p: 0, mr: 1.5 },
        "& .MuiAlert-action": { p: 0, m: 0, ml: "auto", pl: 2, flexShrink: 0, alignItems: "center" },
      }} action={<Button color="inherit" size="small" sx={{ minHeight: 44, p: 1, whiteSpace: "nowrap" }} onClick={() => { retryConnection.current(); invalidateLiveData(); }}>Retry update</Button>}>
        {state === "offline" ? "You're offline. Live updates will resume when you reconnect."
          : state === "connecting" ? "Connecting live updates."
          : "Live updates disconnected. Reconnecting automatically."}
      </Alert>
    </Box>}
    {children}
  </Box>;
}
