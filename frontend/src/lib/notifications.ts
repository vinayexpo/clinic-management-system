import { useCallback, useEffect, useRef, useState } from "react";
import { notificationApi, type NotificationRow } from "../api";
import { checkPushSubscription, currentPermission, isPushSupported, registerServiceWorker, subscribeToPush, unsubscribeFromPush, type PushState } from "./push";
import type { Page } from "../navigation";
import { useLiveRefresh } from "./realtime";

/**
 * Staff destinations a notification can open. Backend event pages such as "Visits"
 * and "Bills" map onto the closest screen the signed-in role can actually use.
 */
export const NOTIFICATION_PAGES: Record<string, Page> = {
  dashboard: "Dashboard",
  patients: "Patients",
  appointments: "Appointments",
  consultation: "Consultation",
  visits: "Consultation",
  prescriptions: "Prescriptions",
  billing: "Billing",
  bills: "Billing",
  reports: "Reports",
  staff: "Staff",
  settings: "Settings",
};

export function notificationPage(page: string | null | undefined, role: string): Page | null {
  const mapped = NOTIFICATION_PAGES[(page ?? "").toLowerCase()];
  if (!mapped) return null;
  if (role === "doctor" && (mapped === "Billing" || mapped === "Staff" || mapped === "Settings" || mapped === "Reports")) return null;
  if (role === "receptionist" && (mapped === "Staff" || mapped === "Settings" || mapped === "Reports" || mapped === "Consultation" || mapped === "Prescriptions")) return null;
  if (role === "patient" && (mapped === "Patients" || mapped === "Appointments" || mapped === "Staff" || mapped === "Settings" || mapped === "Reports")) return null;
  return mapped;
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

interface UseNotifications {
  items: NotificationRow[];
  unread: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  pushState: PushState;
  pushSupported: boolean;
  pushBusy: boolean;
  pushMessage: string | null;
  enablePush: () => Promise<PushState>;
  disablePush: () => Promise<PushState>;
}

const POLL_INTERVAL_MS = 45_000;

/** Loads the signed-in user's notifications, keeps the unread badge fresh, and manages the push subscription. */
export function useNotifications(token: string, role: string): UseNotifications {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [pushState, setPushState] = useState<PushState>(() =>
    isPushSupported() ? (currentPermission() as PushState) : "unsupported",
  );
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const loadedPages = useRef(1);
  const history = useRef(items);
  history.current = items;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const identity = useRef(token);
  identity.current = token;
  const morePending = useRef(false);

  useEffect(() => {
    // React StrictMode mounts, unmounts, then mounts again in development. The flag has to be
    // reset on every mount, otherwise updates are discarded after the first cleanup.
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!token || !isPushSupported()) return;

    if (Notification.permission === "denied") {
      setPushState("denied");
      return;
    }

    void (async () => {
      try {
        const [hasLocalSub, serverKey] = await Promise.all([
          checkPushSubscription(),
          notificationApi.pushKey(token).catch(() => null),
        ]);
        if (!active || !mounted.current) return;
        const serverSubscribed = (serverKey as { data?: { subscribed?: boolean } })?.data?.subscribed;
        if (hasLocalSub || serverSubscribed) {
          setPushState("subscribed");
        } else if (Notification.permission === "granted") {
          setPushState("granted");
        } else {
          setPushState("default");
        }
      } catch {
        // preserve current permission state
      }
    })();

    return () => {
      active = false;
    };
  }, [token]);

  const refresh = useCallback(async () => {
    const run = async () => {
      if (!token || identity.current !== token) return;
      try {
        const [lists, count] = await Promise.all([
          Promise.all(Array.from({ length: loadedPages.current }, (_, index) => notificationApi.list(token, index + 1))),
          notificationApi.unreadCount(token),
        ]);
        if (!mounted.current || identity.current !== token) return;
        const pages = lists as unknown as { data: { data: NotificationRow[]; last_page: number; current_page: number } }[];
        const oldest = history.current[history.current.length - 1];
        const cutoff = oldest?.created_at ? new Date(oldest.created_at).getTime() : NaN;
        let rows = pages.flatMap((page) => page.data.data ?? []);
        let payload = pages[pages.length - 1];
        // New notifications shift offset pages. Read through the previously visible
        // oldest row rather than dropping that history at the old page boundary.
        while (oldest && Number.isFinite(cutoff) && !rows.some((row) => row.id === oldest.id)
          && (payload.data.current_page ?? pages.length) < (payload.data.last_page ?? 1)
          && new Date(rows[rows.length - 1]?.created_at ?? 0).getTime() >= cutoff) {
          const next = await notificationApi.list(token, pages.length + 1);
          if (!mounted.current || identity.current !== token) return;
          payload = next as unknown as typeof payload;
          pages.push(payload);
          rows.push(...(payload.data.data ?? []));
        }
        if (pages.length > loadedPages.current) {
          const boundary = rows.findIndex((row) => row.id === oldest?.id);
          rows = boundary >= 0 ? rows.slice(0, boundary + 1) : rows.filter((row) => new Date(row.created_at ?? 0).getTime() >= cutoff);
        }
        const counter = count as unknown as { data: { unread: number } };
        const updated = Array.from(new Map(rows.map((row) => [row.id, row])).values());
        history.current = updated;
        setItems(updated);
        loadedPages.current = Math.min(loadedPages.current, payload.data.last_page ?? 1);
        setHasMore(loadedPages.current < (payload.data.last_page ?? 1));
        setUnread(counter.data.unread ?? 0);
        setError("");
      } catch (e: unknown) {
        if (mounted.current && identity.current === token) setError(e instanceof Error ? e.message : "Could not load notifications.");
      }
    };
    queue.current = queue.current.then(run, run);
    await queue.current;
  }, [token]);

  /** Fetches the next page of older notifications and appends it to the list. */
  const loadMore = useCallback(async () => {
    if (!token || !hasMore || morePending.current) return;
    morePending.current = true;
    setLoadingMore(true);
    const run = async () => {
      if (identity.current !== token) return;
      try {
        const nextPage = loadedPages.current + 1;
        const list = await notificationApi.list(token, nextPage);
        if (!mounted.current || identity.current !== token) return;
        const payload = list as unknown as { data: { data: NotificationRow[]; last_page: number; current_page: number } };
        loadedPages.current = nextPage;
        setItems((current) => {
          const updated = Array.from(new Map([...current, ...(payload.data.data ?? [])].map((row) => [row.id, row])).values());
          history.current = updated;
          return updated;
        });
        setHasMore((payload.data.current_page ?? nextPage) < (payload.data.last_page ?? nextPage));
      } catch {
        if (mounted.current && identity.current === token) setError("Could not load more notifications.");
      } finally { if (mounted.current && identity.current === token) setLoadingMore(false); }
    };
    queue.current = queue.current.then(run, run);
    try { await queue.current; } finally { morePending.current = false; }
  }, [token, hasMore]);

  useEffect(() => {
    loadedPages.current = 1;
    history.current = [];
    setItems([]);
    setUnread(0);
    setHasMore(false);
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [refresh]);
  useLiveRefresh(refresh, !!token);

  // Keep the badge current without a websocket server.
  useEffect(() => {
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [refresh]);

  // Register the service worker so push can be received even when the app is closed.
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  const markRead = useCallback(async (id: string) => {
    setItems((current) => current.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
    setUnread((count) => Math.max(0, count - 1));
    try {
      await notificationApi.markRead(token, id);
    } catch {
      void refresh();
    }
  }, [token, refresh]);

  const markAllRead = useCallback(async () => {
    setItems((current) => current.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    setUnread(0);
    try {
      await notificationApi.markAllRead(token);
    } catch {
      void refresh();
    }
  }, [token, refresh]);

  const remove = useCallback(async (id: string) => {
    setItems((current) => current.filter((n) => n.id !== id));
    try {
      await notificationApi.remove(token, id);
    } catch {
      void refresh();
    }
  }, [token, refresh]);

  const enablePush = useCallback(async () => {
    if (!token) return "default";
    setPushBusy(true);
    setPushMessage(null);
    try {
      const key = await notificationApi.pushKey(token);
      const publicKey = (key as unknown as { data: { public_key: string; enabled: boolean } }).data;
      if (!publicKey?.enabled || !publicKey?.public_key) {
        setPushState("default");
        setPushMessage("Push notifications are not configured on this server.");
        return "default" as PushState;
      }
      const result = await subscribeToPush(token, publicKey.public_key);
      if (!mounted.current) return result;
      setPushState(result);
      if (result === "denied") {
        setPushMessage("Notifications were blocked in your browser. Please allow them in site settings.");
      } else if (result === "subscribed") {
        setPushMessage("Push notifications are active.");
      }
      return result;
    } catch (e: unknown) {
      if (!mounted.current) return "default";
      const msg = e instanceof Error ? e.message : "Failed to enable push alerts.";
      setPushMessage(msg);
      setPushState(currentPermission() as PushState);
      return "default" as PushState;
    } finally {
      if (mounted.current) setPushBusy(false);
    }
  }, [token]);

  const disablePush = useCallback(async () => {
    if (!token) return "default";
    setPushBusy(true);
    setPushMessage(null);
    try {
      const result = await unsubscribeFromPush(token);
      if (!mounted.current) return result;
      setPushState(result);
      setPushMessage("Push alerts turned off.");
      return result;
    } catch (e: unknown) {
      if (!mounted.current) return "default";
      setPushMessage(e instanceof Error ? e.message : "Failed to disable push notifications.");
      return "default" as PushState;
    } finally {
      if (mounted.current) setPushBusy(false);
    }
  }, [token]);

  return {
    items,
    unread,
    loading,
    loadingMore,
    hasMore,
    error,
    refresh,
    loadMore,
    markRead,
    markAllRead,
    remove,
    pushState,
    pushSupported: isPushSupported(),
    pushBusy,
    pushMessage,
    enablePush,
    disablePush,
  };
}
