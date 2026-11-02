import { useEffect, useRef, useSyncExternalStore } from "react";

type ConnectionState = "idle" | "connecting" | "live" | "reconnecting" | "offline";
const listeners = new Set<() => void>();
const statusListeners = new Set<() => void>();
let connectionState: ConnectionState = "idle";
let sessionActive = false;

export function setRealtimeState(state: ConnectionState) {
  connectionState = state;
  statusListeners.forEach((listener) => listener());
}

export function setRealtimeSession(active: boolean) {
  sessionActive = active;
}

export function invalidateLiveData() {
  if (sessionActive) listeners.forEach((listener) => listener());
}

export function useRealtimeState() {
  return useSyncExternalStore(
    (listener) => { statusListeners.add(listener); return () => { statusListeners.delete(listener); }; },
    () => connectionState,
  );
}

/** Refresh mounted readers without remounting their forms; serialize bursts and keep a trailing update. */
export function useLiveRefresh(callback: () => void | Promise<unknown>, enabled = true) {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let running = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      timer = undefined;
      if (!active) return;
      if (running) { pending = true; return; }
      running = true;
      try { await latest.current(); }
      catch (error) { console.warn("Live data refresh failed", error); }
      finally {
        running = false;
        if (active && pending) { pending = false; schedule(); }
      }
    };
    const schedule = () => {
      if (!timer && active) timer = setTimeout(() => { void run(); }, 200);
    };
    listeners.add(schedule);
    return () => { active = false; listeners.delete(schedule); clearTimeout(timer); };
  }, [enabled]);
}
