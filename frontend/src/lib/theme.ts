import { createTheme, type Theme } from "@mui/material";

export interface ClinicTheme {
  primary: string;
  accent: string;
  background: string;
  surface: string;
}

/** The palette the app shipped with. */
export const DEFAULT_CLINIC_THEME: ClinicTheme = {
  primary: "#0b6b68",
  accent: "#c87949",
  background: "#f5f7f4",
  surface: "#ffffff",
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

/** Mixes a colour with white (amount 0..1 towards white). */
export function mixWithWhite(hex: string, amount: number): string {
  const [r, g, b] = toRgb(hex);
  const mix = (channel: number) => clamp(channel + (255 - channel) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Mixes a colour with black (amount 0..1 towards black). */
export function mixWithBlack(hex: string, amount: number): string {
  const [r, g, b] = toRgb(hex);
  const mix = (channel: number) => clamp(channel * (1 - amount));
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function isHexColour(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** Fills in any missing colour with the shipped default. */
export function normaliseTheme(theme: Partial<ClinicTheme> | null | undefined): ClinicTheme {
  return {
    primary: isHexColour(theme?.primary) ? theme!.primary : DEFAULT_CLINIC_THEME.primary,
    accent: isHexColour(theme?.accent) ? theme!.accent : DEFAULT_CLINIC_THEME.accent,
    background: isHexColour(theme?.background) ? theme!.background : DEFAULT_CLINIC_THEME.background,
    surface: isHexColour(theme?.surface) ? theme!.surface : DEFAULT_CLINIC_THEME.surface,
  };
}

/**
 * The CSS custom properties the stylesheet reads.
 *
 * The brand colour drives its own tints, so one choice repaints every accent
 * surface in the app instead of leaving mismatched greens behind.
 */
export function themeVariables(theme: ClinicTheme): Record<string, string> {
  const primary = theme.primary;
  return {
    "--clinic-page": theme.background,
    "--clinic-paper": theme.surface,
    "--clinic-action": primary,
    "--clinic-action-dark": mixWithBlack(primary, 0.22),
    "--clinic-action-soft": mixWithWhite(primary, 0.88),
    "--clinic-action-tint": mixWithWhite(primary, 0.9),
    "--clinic-action-pale": mixWithWhite(primary, 0.95),
    "--clinic-action-line": mixWithWhite(primary, 0.85),
    "--clinic-action-line-soft": mixWithWhite(primary, 0.88),
    "--clinic-action-border": mixWithWhite(primary, 0.72),
    "--clinic-action-outline": mixWithWhite(primary, 0.55),
    "--clinic-action-faint": mixWithWhite(primary, 0.96),
    "--clinic-action-wash": mixWithWhite(primary, 0.94),
    "--clinic-action-ink": mixWithBlack(primary, 0.3),
    "--clinic-action-shadow": `0 8px 18px ${hexToRgba(primary, 0.22)}`,
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Applies the palette to the document so plain CSS follows the theme too. */
export function applyThemeVariables(theme: ClinicTheme): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeVariables(theme))) {
    root.style.setProperty(name, value);
  }
}

export function buildAppTheme(theme: ClinicTheme): Theme {
  const primary = theme.primary;
  return createTheme({
    palette: {
      mode: "light",
      primary: { main: primary, dark: mixWithBlack(primary, 0.22), light: mixWithWhite(primary, 0.88) },
      secondary: { main: theme.accent },
      background: { default: theme.background, paper: theme.surface },
      text: { primary: "#19302f", secondary: "#637372" },
      success: { main: "#398760" },
      warning: { main: "#b87422" },
      error: { main: "#c65853" },
    },
    typography: {
      fontFamily: '"DM Sans", "Segoe UI", sans-serif',
      h1: { fontFamily: "Georgia, serif", fontWeight: 500 },
      h2: { fontFamily: "Georgia, serif", fontWeight: 500 },
      h3: { fontFamily: "Georgia, serif", fontWeight: 500 },
    },
    shape: { borderRadius: 14 },
    components: {
      MuiButton: { styleOverrides: { root: { textTransform: "none", fontWeight: 700, borderRadius: 10 } } },
      MuiTextField: { defaultProps: { size: "small" } },
      MuiCard: { styleOverrides: { root: { boxShadow: "0 8px 24px rgba(25,48,47,.06)", border: "1px solid #e5ece8" } } },
    },
  });
}
