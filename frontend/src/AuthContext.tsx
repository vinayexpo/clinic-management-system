import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authApi, type ApiUser, type UserRole } from "./api";
import { useLiveRefresh } from "./lib/realtime";

export type { UserRole };
export type AppUser = ApiUser;
export interface AuthState {
  user: ApiUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
  error: string | null;
  hasRole: (...roles: UserRole[]) => boolean;
  adoptSession: (user: ApiUser, token: string) => void;
  /** Reload the signed-in user, for example after a profile photo change. */
  refreshUser: () => Promise<void>;
}

const SESSION_TOKEN = "carehaven_token";
const SESSION_USER = "carehaven_user";

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(() => {
      try { const v = sessionStorage.getItem(SESSION_USER); return v ? (JSON.parse(v) as ApiUser) : null; } catch { return null; }
  });
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(SESSION_TOKEN));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) sessionStorage.setItem(SESSION_TOKEN, token);
    else sessionStorage.removeItem(SESSION_TOKEN);
  }, [token]);
  useEffect(() => {
    if (user) sessionStorage.setItem(SESSION_USER, JSON.stringify(user));
    else sessionStorage.removeItem(SESSION_USER);
  }, [user]);

  useEffect(() => {
    const expireSession = () => {
      setUser(null);
      setToken(null);
      setError("Your session has expired. Sign in again.");
    };
    window.addEventListener("clinic:session-expired", expireSession);
    return () => window.removeEventListener("clinic:session-expired", expireSession);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await authApi.login(email, password);
      // ApiItem<{user,token}> wrapped in {data: ...}
      const payload = (res as unknown as { data: { user: ApiUser; token: string } }).data;
      setUser(payload.user);
      setToken(payload.token);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Sign-in failed.";
      setError(msg);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** Used by first-run signup: stores the admin session returned by POST /setup/admin. */
  const adoptSession = useCallback((nextUser: ApiUser, nextToken: string) => {
    setUser(nextUser);
    setToken(nextToken);
  }, []);

  const logout = useCallback(() => {
    if (token) authApi.logout(token).catch(() => {});
    setUser(null);
    setToken(null);
    setError(null);
  }, [token]);

  const hasRole = useCallback((...roles: UserRole[]) => !!user && roles.includes(user.role as UserRole), [user]);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const res = await authApi.me(token);
      const next = (res as unknown as { data: ApiUser }).data;
      if (!next.is_active || !["admin", "doctor", "receptionist", "patient"].includes(next.role)) {
        window.dispatchEvent(new CustomEvent("clinic:session-expired"));
        return;
      }
      setUser(next);
    } catch {
      // Keep the signed-in session; the next explicit action surfaces the error.
    }
  }, [token]);
  useLiveRefresh(refreshUser, !!token);

  const value = useMemo<AuthState>(() => ({ user, token, login, logout, isLoading, error, hasRole, adoptSession, refreshUser }), [user, token, login, logout, isLoading, error, hasRole, adoptSession, refreshUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
