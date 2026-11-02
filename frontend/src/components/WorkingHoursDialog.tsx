import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { doctorApi, type DoctorScheduleRow } from "../api";
import { useLiveRefresh } from "../lib/realtime";

/** Sunday-first to match the stored day_of_week (0 = Sunday ... 6 = Saturday). */
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Block = { start: string; end: string };
type Week = Record<number, Block[]>; // day -> blocks; a day with no blocks is closed

const hhmm = (t: string) => String(t).slice(0, 5);

function toWeek(rows: DoctorScheduleRow[]): Week {
  const week: Week = {};
  for (const d of [0, 1, 2, 3, 4, 5, 6]) week[d] = [];
  for (const r of rows) week[r.day_of_week].push({ start: hhmm(r.start_time), end: hhmm(r.end_time) });
  for (const d of Object.keys(week)) week[Number(d)].sort((a, b) => a.start.localeCompare(b.start));
  return week;
}

/** Returns the first problem with the week, or null. Mirrors the server's rules. */
export function validateWeek(week: Week): string | null {
  for (const d of [0, 1, 2, 3, 4, 5, 6]) {
    const blocks = [...week[d]].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b.start || !b.end) return `${WEEKDAYS[d]}: set both start and end times.`;
      if (b.start >= b.end) return `${WEEKDAYS[d]}: a block must end after it starts.`;
      if (i > 0 && blocks[i - 1].end > b.start) return `${WEEKDAYS[d]}: blocks overlap.`;
    }
  }
  return null;
}

/** Flattens the week into the API's block list, closed days produce nothing. */
export function toBlocks(week: Week) {
  return [0, 1, 2, 3, 4, 5, 6].flatMap((d) =>
    week[d].map((b) => ({ day_of_week: d, start_time: b.start, end_time: b.end })),
  );
}

/**
 * Weekly working-hours editor for one doctor. Each day is open (one or more time blocks)
 * or closed. Saving replaces the whole week in one request.
 */
export function WorkingHoursDialog({ token, doctorId, doctorName, onClose, onSaved }: {
  token: string; doctorId: number; doctorName: string; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [week, setWeek] = useState<Week | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyFrom, setCopyFrom] = useState(1);
  const baseline = useRef("");
  const [stale, setStale] = useState(false);
  const editor = useRef({ week, busy });
  editor.current = { week, busy };

  const load = async () => {
    try {
      const r = await doctorApi.schedules(token, doctorId);
      const next = toWeek((r as unknown as { data: DoctorScheduleRow[] }).data);
      const saved = JSON.stringify(next);
      const local = editor.current;
      if (local.busy || (local.week && JSON.stringify(local.week) !== baseline.current)) {
        setStale(saved !== baseline.current);
        return;
      }
      baseline.current = saved;
      setWeek(next);
      setStale(false);
      setLoadError("");
    } catch (e: unknown) { setLoadError(e instanceof Error ? e.message : "Could not load working hours."); }
  };
  useLiveRefresh(load, !!token);

  useEffect(() => {
    void load();
    // The live hook uses the latest editor state without resetting the initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, doctorId]);

  const problem = useMemo(() => (week ? validateWeek(week) : null), [week]);
  const totalBlocks = week ? Object.values(week).reduce((n, b) => n + b.length, 0) : 0;

  const setDay = (d: number, blocks: Block[]) => setWeek((w) => (w ? { ...w, [d]: blocks } : w));
  const toggleDay = (d: number, open: boolean) => setDay(d, open ? [{ start: "09:00", end: "13:00" }] : []);
  const updateBlock = (d: number, i: number, patch: Partial<Block>) =>
    week && setDay(d, week[d].map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const addBlock = (d: number) => {
    if (!week) return;
    const last = week[d][week[d].length - 1];
    const start = last ? last.end : "09:00";
    const end = last && last.end < "20:00" ? "20:00" : start;
    setDay(d, [...week[d], { start, end }]);
  };
  const removeBlock = (d: number, i: number) => week && setDay(d, week[d].filter((_, idx) => idx !== i));

  const copyDay = (target: number) => {
    if (!week) return;
    setDay(target, week[copyFrom].map((b) => ({ ...b })));
  };

  const save = async () => {
    if (!week) return;
    setSaveError("");
    const p = validateWeek(week);
    if (p) { setSaveError(p); return; }
    setBusy(true);
    try {
      await doctorApi.replaceSchedule(token, doctorId, toBlocks(week));
      baseline.current = JSON.stringify(week);
      setStale(false);
      onSaved(`Working hours saved for ${doctorName}`);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Could not save working hours.");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>Working hours for {doctorName}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Set this doctor’s weekly working hours in IST. Add a second block for a split shift. Closed days have no bookable time.
        </Typography>
        {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
        {stale && <Alert severity="warning" sx={{ mb: 2 }}>Working hours changed elsewhere. Your edits are kept. Close and reopen to load the saved hours before saving.</Alert>}
        {saveError && <Alert severity="error" sx={{ mb: 2 }}>{saveError}</Alert>}
        {!week && !loadError && <Box sx={{ display: "grid", placeItems: "center", py: 4 }}><CircularProgress /></Box>}

        {week && (
          <Stack spacing={1.5}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const open = week[d].length > 0;
              return (
                <Box key={d} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "150px 1fr" }, gap: 1.5, alignItems: "start", p: 1.5, border: "1px solid #e5ece8", borderRadius: 2, opacity: open ? 1 : 0.75 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Switch checked={open} onChange={(e) => toggleDay(d, e.target.checked)} inputProps={{ "aria-label": `${WEEKDAYS[d]} open` }} />
                    <Typography fontWeight={700}>{WEEKDAYS[d]}</Typography>
                  </Stack>
                  {!open && <Typography color="text.secondary" sx={{ py: 1 }}>Closed</Typography>}
                  {open && (
                    <Stack spacing={1}>
                      {week[d].map((b, i) => (
                        <Stack key={i} direction="row" spacing={1} alignItems="center">
                          <TextField type="time" size="small" label="From" value={b.start} onChange={(e) => updateBlock(d, i, { start: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ width: 150 }} />
                          <Typography>–</Typography>
                          <TextField type="time" size="small" label="To" value={b.end} onChange={(e) => updateBlock(d, i, { end: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ width: 150 }} />
                          <IconButton aria-label={`Remove ${WEEKDAYS[d]} block ${i + 1}`} size="small" onClick={() => removeBlock(d, i)}><IconTrash size={16} /></IconButton>
                        </Stack>
                      ))}
                      <Button size="small" startIcon={<IconPlus size={14} />} onClick={() => addBlock(d)} sx={{ alignSelf: "flex-start" }}>Add time block</Button>
                    </Stack>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}

        {week && (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} sx={{ mt: 2 }}>
            <TextField select size="small" label="Copy hours from" value={copyFrom} onChange={(e) => setCopyFrom(Number(e.target.value))} sx={{ width: 200 }}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => <MenuItem key={d} value={d}>{WEEKDAYS[d]}</MenuItem>)}
            </TextField>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              {[1, 2, 3, 4, 5, 6, 0].filter((d) => d !== copyFrom).map((d) => (
                <Button key={d} size="small" variant="outlined" onClick={() => copyDay(d)}>To {WEEKDAYS[d].slice(0, 3)}</Button>
              ))}
            </Stack>
          </Stack>
        )}

        {week && <Typography variant="caption" color={problem ? "error" : "text.secondary"} sx={{ display: "block", mt: 2 }}>{problem ?? `${totalBlocks} working block${totalBlocks === 1 ? "" : "s"} in the week`}</Typography>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" disabled={!week || busy || !!problem} onClick={() => void save()}>
          {busy ? <CircularProgress size={18} /> : "Save working hours"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
