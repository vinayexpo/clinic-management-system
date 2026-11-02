import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { setupApi } from "../api";
import { useLiveRefresh } from "../lib/realtime";
import { DEFAULT_CLINIC_THEME, applyThemeVariables, buildAppTheme, normaliseTheme, type ClinicTheme } from "../lib/theme";

interface ClinicThemeState {
  theme: ClinicTheme;
  /** Re-reads the saved colours, for example right after an administrator saves them. */
  refresh: () => Promise<void>;
}

const ClinicThemeContext = createContext<ClinicThemeState>({ theme: DEFAULT_CLINIC_THEME, refresh: async () => {} });

/**
 * Holds the clinic's colour palette and applies it to the whole app:
 * the MUI theme for components and the CSS custom properties for the stylesheet.
 */
export function ClinicThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ClinicTheme>(DEFAULT_CLINIC_THEME);

  const refresh = useCallback(async () => {
    try {
      const res = await setupApi.status();
      const data = (res as unknown as { data: { theme?: Partial<ClinicTheme> | null } }).data;
      setTheme(normaliseTheme(data.theme));
    } catch { /* Keep the last known palette on transient failures. */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useLiveRefresh(refresh);
  useEffect(() => { applyThemeVariables(theme); }, [theme]);

  const muiTheme = useMemo(() => buildAppTheme(theme), [theme]);
  const value = useMemo(() => ({ theme, refresh }), [theme, refresh]);

  return (
    <ClinicThemeContext.Provider value={value}>
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ClinicThemeContext.Provider>
  );
}

export function useClinicTheme(): ClinicThemeState {
  return useContext(ClinicThemeContext);
}
