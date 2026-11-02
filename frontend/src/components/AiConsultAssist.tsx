import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { IconSparkles, IconTrash } from "@tabler/icons-react";
import { aiApi, type AiConsultDraft, type AiStatus, type VisitRow } from "../api";

const FIELD_LABELS: [keyof AiConsultDraft, string][] = [
  ["examination_notes", "Examination notes"],
  ["diagnosis", "Diagnosis"],
  ["treatment_plan", "Treatment plan"],
  ["follow_up_suggestion", "Follow-up note"],
  ["follow_up_date", "Follow-up date"],
];

/**
 * The "Draft with AI" review panel for one visit: fetch a draft, show every
 * field, and only on confirmation let the doctor copy it into the notes form.
 * Nothing touches the record until they accept or edit first.
 */
export function AiConsultAssist({ token, ai, visit, disabled, busyParent, onApply, toast }: {
  token: string;
  ai: AiStatus | null;
  visit: VisitRow | null;
  disabled: boolean;
  busyParent: boolean;
  onApply: (draft: AiConsultDraft) => void;
  toast: (message: string) => void;
}) {
  const [draft, setDraft] = useState<AiConsultDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const featureOn = ai?.configured === true && ai.features.consultation === true;

  useEffect(() => {
    // A different visit makes any old draft stale.
    setDraft(null);
    setOpen(false);
    setError("");
  }, [visit?.id]);

  const generate = async () => {
    if (!visit) return;
    setLoading(true);
    setError("");
    setOpen(true);
    try {
      const res = await aiApi.consultationDraft(token, visit.id);
      setDraft(res.data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not get an AI draft.");
      setDraft(null);
    } finally { setLoading(false); }
  };

  const apply = () => {
    if (!draft) return;
    onApply(draft);
    setDraft(null);
    setOpen(false);
    toast("AI draft entered into the notes — review and save");
  };

  const closed = visit?.status === "finalized" || visit?.status === "amended";
  const usable = featureOn && !disabled && !closed && Boolean(visit);

  return (
    <Box sx={{ mt: 2, p: 1.75, border: "1px dashed #b9d2c9", borderRadius: 2, bgcolor: "rgba(11,107,104,0.03)" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <IconSparkles size={17} aria-hidden />
          <Typography variant="subtitle2" sx={{ whiteSpace: "nowrap" }}>Draft with AI</Typography>
          <Chip size="small" variant="outlined" label="Review before use" />
        </Stack>
        {closed ? (
          <Typography variant="caption" color="text.secondary">Finalized visits are read-only.</Typography>
        ) : (
          <Button
            variant="outlined"
            size="small"
            startIcon={(loading || busyParent) ? <CircularProgress size={14} color="inherit" /> : <IconSparkles size={15} />}
            disabled={!usable || loading || busyParent}
            onClick={() => void generate()}
            sx={{ whiteSpace: "nowrap" }}
          >
            {draft ? "Regenerate" : "Suggest draft"}
          </Button>
        )}
      </Stack>

      {!open && !error && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
          From this visit's symptoms, vitals and history.
        </Typography>
      )}

      {(open || error) && !draft && !loading && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error || "The draft could not be generated."}
          <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
            <Button size="small" onClick={() => void generate()}>Try again</Button>
          </Stack>
        </Alert>
      )}
      {open && !draft && loading && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
          <CircularProgress size={15} />
          <Typography variant="caption" color="text.secondary">Can take up to a minute.</Typography>
        </Stack>
      )}

      {draft && (
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          {FIELD_LABELS.filter(([key]) => Boolean(draft[key])).map(([key, label]) => (
            <Box key={key}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary" }}>{label}</Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{draft[key]}</Typography>
            </Box>
          ))}
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <Button variant="contained" size="small" onClick={apply}>Use in notes</Button>
            <Button
              size="small"
              startIcon={<IconTrash size={14} />}
              onClick={() => { setDraft(null); setOpen(false); }}
            >
              Discard
            </Button>
          </Stack>
        </Stack>
      )}
    </Box>
  );
}
