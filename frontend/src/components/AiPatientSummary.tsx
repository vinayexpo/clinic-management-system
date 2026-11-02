import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { IconRefresh, IconSparkles } from "@tabler/icons-react";
import { aiApi, type AiStatus, type PatientRow } from "../api";

/**
 * A one-button AI history summary inside the patient dialog. The summary is a
 * reading aid for the visits listed below it — never a replacement for them.
 */
export function AiPatientSummary({ token, ai, patient }: { token: string; ai: AiStatus | null; patient: PatientRow }) {
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const featureOn = ai?.configured === true && ai.features.patient_summary === true;
  if (!featureOn) return null;

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await aiApi.patientSummary(token, patient.id);
      setSummary(res.data.summary);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not summarize this history.");
    } finally { setLoading(false); }
  };

  return (
    <Box sx={{ mt: 2, p: 1.5, border: "1px dashed #b9d2c9", borderRadius: 2, bgcolor: "rgba(11,107,104,0.03)" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Chip size="small" icon={<IconSparkles size={14} />} label="AI summary" variant="outlined" />
        <Button
          variant="outlined"
          size="small"
          startIcon={loading ? <CircularProgress size={14} color="inherit" /> : summary ? <IconRefresh size={15} /> : <IconSparkles size={15} />}
          disabled={loading}
          onClick={() => void generate()}
        >
          {summary ? "Refresh" : `Summarize ${patient.first_name}'s history`}
        </Button>
      </Stack>
      {loading && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>Reading consultations…</Typography>}
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      {summary && !loading && (
        <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{summary}</Typography>
      )}
      {summary && !loading && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          Draft from the recorded consultations — verify important details against the visit notes below.
        </Typography>
      )}
    </Box>
  );
}
