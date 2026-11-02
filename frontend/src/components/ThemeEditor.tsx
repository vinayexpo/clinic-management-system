import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { IconPalette, IconRestore } from "@tabler/icons-react";
import { clinicApi, type ClinicSettingRow } from "../api";
import { useClinicTheme } from "./ClinicThemeProvider";
import { DEFAULT_CLINIC_THEME, isHexColour, type ClinicTheme } from "../lib/theme";

const FIELDS: { key: keyof ClinicTheme; label: string; help: string }[] = [
  { key: "primary", label: "Primary colour", help: "Buttons, active navigation, links and the clinic mark." },
  { key: "accent", label: "Accent colour", help: "Secondary highlights and small badges." },
  { key: "background", label: "Page background", help: "The area behind the cards." },
  { key: "surface", label: "Card surface", help: "The card and panel background." },
];

/**
 * Lets an administrator recolour the whole clinic app.
 *
 * The palette is stored with the clinic settings, so every signed-in screen and
 * the sign-in screen use the same colours.
 */
export function ThemeEditor({ token, clinic, onSaved }: { token: string; clinic: ClinicSettingRow | null; onSaved: (clinic: ClinicSettingRow) => void }) {
  const { theme, refresh } = useClinicTheme();
  const [draft, setDraft] = useState<ClinicTheme>(theme);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const baseline = useRef(theme);
  const [stale, setStale] = useState(false);
  const editor = useRef({ draft, busy });
  editor.current = { draft, busy };

  useEffect(() => {
    if (JSON.stringify(theme) === JSON.stringify(baseline.current)) return;
    if (editor.current.busy || JSON.stringify(editor.current.draft) !== JSON.stringify(baseline.current)) {
      setStale(true);
      return;
    }
    baseline.current = theme;
    setDraft(theme);
    setStale(false);
  }, [theme]);

  const changed = (Object.keys(draft) as (keyof ClinicTheme)[]).some((key) => draft[key] !== baseline.current[key]);

  const save = async () => {
    setBusy(true); setError("");
    try {
      const res = await clinicApi.update(token, {
        clinic_name: clinic?.clinic_name ?? "Carehaven",
        theme: draft,
      });
      onSaved((res as unknown as { data: ClinicSettingRow }).data);
      baseline.current = draft;
      setStale(false);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "The colours could not be saved.");
    } finally { setBusy(false); }
  };

  const reset = () => setDraft(DEFAULT_CLINIC_THEME);

  return (
    <Card sx={{ mt: 2 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Box>
            <Typography component="h2" variant="h6" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <IconPalette size={18} /> Clinic colours
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              These colours apply to the whole app, including the sign-in screen.
            </Typography>
          </Box>
          {changed && <Chip size="small" color="warning" label="Unsaved changes" />}
        </Stack>

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        {stale && <Alert severity="warning" sx={{ mt: 2 }} action={<Button color="inherit" size="small" disabled={busy} onClick={() => { baseline.current = theme; setDraft(theme); setStale(false); }}>Discard edits and reload</Button>}>Clinic colours changed elsewhere. Your unsaved colours are kept.</Alert>}

        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
          {FIELDS.map((field) => (
            <Box key={field.key} sx={{ flex: "1 1 200px", minWidth: 0 }}>
              <TextField
                fullWidth
                size="small"
                label={field.label}
                type="color"
                value={isHexColour(draft[field.key]) ? draft[field.key] : DEFAULT_CLINIC_THEME[field.key]}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                helperText={field.help}
                InputLabelProps={{ shrink: true }}
                inputProps={{ style: { height: 44, padding: 4, cursor: "pointer" } }}
              />
            </Box>
          ))}
        </Stack>

        <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button variant="contained" onClick={() => void save()} disabled={busy || !changed}>
            {busy ? "Saving..." : "Save colours"}
          </Button>
          <Button variant="outlined" startIcon={<IconRestore size={16} />} onClick={reset} disabled={busy}>
            Reset to default
          </Button>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ ml: 1 }}>
            <Typography variant="caption" color="text.secondary">Preview</Typography>
            <Button size="small" variant="contained" sx={{ bgcolor: draft.primary, "&:hover": { bgcolor: draft.primary } }}>
              Primary
            </Button>
            <Button size="small" variant="outlined" sx={{ borderColor: draft.accent, color: draft.accent }}>
              Accent
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
