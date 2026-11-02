import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { IconSend, IconSparkles, IconX } from "@tabler/icons-react";
import { aiApi, type AiStatus, type PatientRow } from "../api";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const WELCOME: ChatTurn = {
  role: "assistant",
  content: "Ask anything about the clinic. Attach a patient to ground a question in their record. Replies are drafts.",
};

function patientLabel(p: PatientRow): string {
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
  return `${name || `Patient ${p.id}`} (${p.patient_number})`;
}

/**
 * A small ask-anything chat for staff. Optionally grounded in one patient's
 * record; the patient's details only travel to the provider when a staff
 * member attaches them to a question.
 */
export function AIAssistant({ token, patients, ai, open, onClose }: { token: string; patients: PatientRow[]; ai: AiStatus | null; open: boolean; onClose: () => void }) {
  const [patientId, setPatientId] = useState<number | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([WELCOME]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const ready = ai?.configured === true && ai.features.assistant === true;

  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [turns, open]);

  const ask = async () => {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    const history = turns.filter((t) => t !== WELCOME).slice(-6).map((t) => ({ role: t.role, content: t.content }));
    setTurns((all) => [...all, { role: "user", content: text }]);
    setQuestion("");
    try {
      const res = await aiApi.ask(token, { question: text, patient_id: patientId ?? undefined, history: patientId ? history : undefined });
      setTurns((all) => [...all, { role: "assistant", content: res.data.answer }]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "The assistant could not reply. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-label="Clinic AI assistant">
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <IconSparkles size={20} />
          <span>Clinic assistant</span>
          {ready && ai?.model && <Chip size="small" variant="outlined" label={ai.model} />}
        </Stack>
        <IconButton aria-label="Close assistant" onClick={onClose}><IconX size={18} /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ minWidth: 0 }}>
        {!ready && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {ai?.configured
              ? "The clinic assistant is switched off. An administrator can turn it on in Settings."
              : "AI is not configured yet. An administrator can set it up in Settings."}
          </Alert>
        )}
        {ready && (
          <>
            <Autocomplete
              options={patients}
              value={patients.find((p) => p.id === patientId) ?? null}
              getOptionLabel={patientLabel}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              onChange={(_, p) => setPatientId(p?.id ?? null)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  label="Attach a patient (optional)"
                  placeholder="Search name, phone or patient ID"
                  helperText={patientId ? "Their recent record summary goes with your questions." : "Clear to ask unattached."}
                />
              )}
            />
            <Box ref={scrollRef} sx={{ mt: 2, mb: 1, maxHeight: "42vh", overflowY: "auto", pr: 1 }}>
              {turns.map((turn, i) => (
                <Stack
                  key={i}
                  direction="row"
                  justifyContent={turn.role === "user" ? "flex-end" : "flex-start"}
                  sx={{ my: 1 }}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      maxWidth: "86%",
                      px: 1.5,
                      py: 1,
                      borderRadius: 2,
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      bgcolor: turn.role === "user" ? "primary.main" : "grey.100",
                      color: turn.role === "user" ? "primary.contrastText" : "text.primary",
                    }}
                  >
                    {turn.content}
                  </Typography>
                </Stack>
              ))}
              {busy && <Stack direction="row" spacing={1} alignItems="center" sx={{ my: 1 }}><CircularProgress size={16} /><Typography variant="caption" color="text.secondary">Replying…</Typography></Stack>}
              {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
            </Box>
          </>
        )}
      </DialogContent>
      {ready && (
        <>
          <DialogActions sx={{ px: 3, pt: 0 }}><Typography variant="caption" color="text.secondary">Answers come from the records sent with each question.</Typography></DialogActions>
          <DialogActions sx={{ px: 3, pb: 2, pt: 0 }}>
            <TextField
              fullWidth
              autoFocus
              size="small"
              multiline
              maxRows={3}
              label="Ask the assistant"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask();
                }
              }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Button variant="contained" disabled={busy || !question.trim()} endIcon={<IconSend size={16} />} onClick={() => void ask()}>
                      Ask
                    </Button>
                  </InputAdornment>
                ),
              }}
            />
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
