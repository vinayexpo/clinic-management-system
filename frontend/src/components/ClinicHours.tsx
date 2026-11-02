import { useMemo } from "react";
import { Alert, Box, Stack, Switch, TextField, Typography } from "@mui/material";
import { CLINIC_TZ } from "../lib/ist";

/** Sunday-first, matching the stored keys "0".."6". */
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type DayHours = { open: string; close: string } | null;
export type ClinicHours = Record<string, DayHours>;

/** Display order starts Monday, the usual clinic week. */
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const closedWeek = (): ClinicHours => Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), null]));

const hhmm = (t: string) => String(t).slice(0, 5);

/** Normalizes whatever the API returned (possibly null or an empty array) into the full 7-day shape. */
export function readClinicHours(raw: unknown): ClinicHours | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) && raw.length === 0) return null;
  const src = raw as Record<string, unknown>;
  const out: ClinicHours = {};
  for (let d = 0; d <= 6; d++) {
    const v = src[String(d)] as { open?: string; close?: string } | null | undefined;
    out[String(d)] = v && v.open && v.close ? { open: hhmm(v.open), close: hhmm(v.close) } : null;
  }
  return out;
}

/** Text shown in the sidebar, e.g. "Mon–Sat 09:00–20:00" or "Mon–Fri 09:00–20:00, Sat 09:00–14:00". */
export function summarizeHours(hours: ClinicHours): string {
  const parts: string[] = [];
  const groups: { days: number[]; range: string }[] = [];
  for (const d of ORDER) {
    const h = hours[String(d)];
    if (!h) continue;
    const range = `${h.open}–${h.close}`;
    const last = groups[groups.length - 1];
    if (last && last.range === range && last.days[last.days.length - 1] === ORDER[ORDER.indexOf(d) - 1]) last.days.push(d);
    else groups.push({ days: [d], range });
  }
  if (!groups.length) return "Closed all week";
  for (const g of groups) {
    const first = DAY_NAMES[g.days[0]].slice(0, 3);
    const last = DAY_NAMES[g.days[g.days.length - 1]].slice(0, 3);
    parts.push(`${g.days.length > 1 ? `${first}–${last}` : first} ${g.range}`);
  }
  return parts.join(", ");
}

/**
 * Open / closed right now, computed in the clinic's timezone. Returns null when hours
 * are not configured, so the UI can say so instead of guessing.
 */
export function openStatus(hours: ClinicHours | null, _timezone = CLINIC_TZ, now = new Date()): { open: boolean; until?: string } | null {
  if (!hours) return null;
  let weekday: number, hm: string;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: CLINIC_TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    hm = `${get("hour").padStart(2, "0")}:${get("minute").padStart(2, "0")}`;
  } catch {
    return null;
  }
  const today = hours[String(weekday)];
  if (today && hm >= today.open && hm < today.close) return { open: true, until: today.close };
  return { open: false };
}

/** Weekly opening-hours editor. Closed days store null; open days need open < close. */
export function ClinicHoursEditor({ value, onChange }: { value: ClinicHours | null; onChange: (v: ClinicHours) => void }) {
  const week = useMemo(() => value ?? closedWeek(), [value]);
  const problem = useMemo(() => {
    for (const d of ORDER) {
      const h = week[String(d)];
      if (h && (!h.open || !h.close)) return `${DAY_NAMES[d]}: enter opening and closing times.`;
      if (h && h.open >= h.close) return `${DAY_NAMES[d]}: opening time must be before closing time.`;
    }
    return null;
  }, [week]);

  const setDay = (d: number, next: DayHours) => onChange({ ...week, [String(d)]: next });

  return (
    <Stack spacing={1.25}>
      {!value && <Alert severity="info">Hours have not been set. Turn on each working day and enter its hours.</Alert>}
      {ORDER.map((d) => {
        const h = week[String(d)];
        return (
          <Box key={d} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "130px 1fr" }, gap: 1, alignItems: "center" }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Switch size="small" checked={!!h} onChange={(e) => setDay(d, e.target.checked ? { open: "", close: "" } : null)} inputProps={{ "aria-label": `${DAY_NAMES[d]} open` }} />
              <Typography variant="body2" fontWeight={600}>{DAY_NAMES[d].slice(0, 3)}</Typography>
            </Stack>
            {h ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField type="time" size="small" label="Opens" value={h.open} onChange={(e) => setDay(d, { ...h, open: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ width: 140 }} />
                <Typography>–</Typography>
                <TextField type="time" size="small" label="Closes" value={h.close} onChange={(e) => setDay(d, { ...h, close: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ width: 140 }} error={h.open >= h.close} />
              </Stack>
            ) : <Typography color="text.secondary" variant="body2">Closed</Typography>}
          </Box>
        );
      })}
      {problem && <Typography variant="caption" color="error">{problem}</Typography>}
    </Stack>
  );
}
