import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconRefresh,
  IconSend,
  IconSettings,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { aiApi, type AiConsultDraft, type AiStatus, type VisitRow } from "../api";

const FIELD_LABELS: [keyof AiConsultDraft, string][] = [
  ["examination_notes", "Examination notes"],
  ["diagnosis", "Diagnosis"],
  ["treatment_plan", "Treatment plan"],
  ["follow_up_suggestion", "Follow-up note"],
  ["follow_up_date", "Follow-up date"],
];

const PROMPT_SUGGESTIONS = [
  { label: "Draft from symptoms & vitals", text: "Draft comprehensive clinical notes based on the presenting symptoms and vitals." },
  { label: "Polish rough notes", text: "Refine and structure my clinical observations and notes into standard medical phrasing." },
  { label: "Suggest differential diagnosis", text: "Suggest the most likely clinical diagnosis with differential considerations and recommended next steps." },
  { label: "Home care & advice plan", text: "Focus on a detailed treatment plan, lifestyle guidance, and home care instructions for the patient." },
];

export function AiConsultAssist({
  token,
  ai,
  visit,
  currentSymptoms,
  currentVitals,
  currentExam,
  currentDiagnosis,
  currentPlan,
  disabled,
  busyParent,
  onApply,
  onApplyField,
  onOpenSettings,
  toast,
}: {
  token: string;
  ai: AiStatus | null;
  visit: VisitRow | null;
  currentSymptoms?: string;
  currentVitals?: Record<string, unknown>;
  currentExam?: string;
  currentDiagnosis?: string;
  currentPlan?: string;
  disabled: boolean;
  busyParent: boolean;
  onApply: (draft: AiConsultDraft) => void;
  onApplyField?: (field: keyof AiConsultDraft, value: string) => void;
  onOpenSettings?: () => void;
  toast: (message: string) => void;
}) {
  const [draft, setDraft] = useState<AiConsultDraft | null>(null);
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [appliedFields, setAppliedFields] = useState<Record<string, boolean>>({});

  const configured = ai?.configured === true;
  const featureOn = configured && ai.features.consultation === true;
  const closed = visit?.status === "finalized" || visit?.status === "amended";
  const usable = featureOn && !disabled && !closed && Boolean(visit);

  useEffect(() => {
    // A different visit clears any old draft
    setDraft(null);
    setInstructions("");
    setError("");
    setAppliedFields({});
  }, [visit?.id]);

  const generate = async (overridePrompt?: string) => {
    if (!visit) return;
    setLoading(true);
    setError("");
    setExpanded(true);
    const promptToSend = (overridePrompt !== undefined ? overridePrompt : instructions).trim();

    try {
      const res = await aiApi.consultationDraft(token, visit.id, {
        instructions: promptToSend || undefined,
        current_symptoms: currentSymptoms?.trim() || undefined,
        current_vitals: currentVitals,
        current_exam: currentExam?.trim() || undefined,
        current_diagnosis: currentDiagnosis?.trim() || undefined,
        current_plan: currentPlan?.trim() || undefined,
      });
      setDraft(res.data);
      setAppliedFields({});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not get an AI draft.");
      setDraft(null);
    } finally {
      setLoading(false);
    }
  };

  const applyAll = () => {
    if (!draft) return;
    onApply(draft);
    setDraft(null);
    setExpanded(false);
    toast("AI draft entered into all notes fields — review and save");
  };

  const applySingleField = (field: keyof AiConsultDraft) => {
    if (!draft || !draft[field]) return;
    const value = draft[field]!;
    if (onApplyField) {
      onApplyField(field, value);
    } else {
      onApply({ ...draft, [field]: value });
    }
    setAppliedFields((prev) => ({ ...prev, [field]: true }));
    toast(`Inserted AI ${field.replace(/_/g, " ")}`);
  };

  return (
    <Box
      sx={{
        mt: 2.5,
        p: 2,
        borderRadius: 2.5,
        border: "1px solid",
        borderColor: draft ? "primary.main" : "#cde1d8",
        bgcolor: draft ? "rgba(11,107,104,0.04)" : "#f8fbf9",
        boxShadow: draft ? "0 4px 16px rgba(11,107,104,0.08)" : "none",
        transition: "all 0.2s ease-in-out",
      }}
    >
      {/* Header Bar */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: "50%",
              bgcolor: configured ? "primary.main" : "grey.300",
              color: "#fff",
            }}
          >
            <IconSparkles size={16} />
          </Box>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 0.75 }}>
              AI Clinical Notes Assistant
              {configured && ai?.model && (
                <Chip size="small" variant="outlined" label={ai.model} sx={{ height: 20, fontSize: "0.7rem" }} />
              )}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Draft, structure, and polish diagnosis, examination & treatment plans
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          {closed ? (
            <Chip size="small" label="Finalized visit (Read-only)" />
          ) : !configured ? (
            onOpenSettings && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<IconSettings size={15} />}
                onClick={onOpenSettings}
              >
                Configure AI
              </Button>
            )
          ) : (
            <>
              <Button
                variant={draft ? "outlined" : "contained"}
                size="small"
                startIcon={loading || busyParent ? <CircularProgress size={14} color="inherit" /> : <IconSparkles size={15} />}
                disabled={!usable || loading || busyParent}
                onClick={() => void generate()}
                sx={{ whiteSpace: "nowrap" }}
              >
                {draft ? "Regenerate" : "Draft with AI"}
              </Button>
              <IconButton
                size="small"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? "Collapse AI assistant" : "Expand AI assistant"}
              >
                {expanded ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
              </IconButton>
            </>
          )}
        </Stack>
      </Stack>

      {/* When AI is not configured */}
      {!configured && (
        <Alert severity="info" sx={{ mt: 1.5, py: 0.75 }}>
          AI Assistant is not configured yet. An administrator can connect an OpenAI, Google Gemini, or Groq API key in Settings &rarr; AI Assistant.
        </Alert>
      )}

      {/* Expanded Prompt & Controls */}
      <Collapse in={expanded || Boolean(draft) || loading || Boolean(error)}>
        <Box sx={{ mt: 2 }}>
          {/* Clinician Prompt & Dictation Input */}
          {!closed && configured && (
            <Box sx={{ mb: 1.5 }}>
              <TextField
                fullWidth
                size="small"
                multiline
                minRows={1.5}
                maxRows={3}
                label="Clinician instructions or rough dictation (optional)"
                placeholder="e.g. Throat erythema, bilateral wheeze, fever since 2 days. Suggest diagnosis, management plan and warning signs..."
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                disabled={loading || busyParent || !usable}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void generate();
                  }
                }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <Tooltip title="Generate draft with these instructions">
                        <span>
                          <IconButton
                            size="small"
                            color="primary"
                            disabled={loading || busyParent || !usable}
                            onClick={() => void generate()}
                          >
                            {loading ? <CircularProgress size={16} /> : <IconSend size={16} />}
                          </IconButton>
                        </span>
                      </Tooltip>
                    </InputAdornment>
                  ),
                }}
              />

              {/* Quick Prompt Suggestion Chips */}
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                {PROMPT_SUGGESTIONS.map((item, idx) => (
                  <Chip
                    key={idx}
                    size="small"
                    variant="outlined"
                    label={item.label}
                    onClick={() => {
                      setInstructions(item.text);
                      void generate(item.text);
                    }}
                    disabled={loading || busyParent || !usable}
                    sx={{
                      cursor: "pointer",
                      fontSize: "0.725rem",
                      height: 24,
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  />
                ))}
              </Stack>
            </Box>
          )}

          {/* Loading Indicator */}
          {loading && (
            <Box sx={{ p: 2, textAlign: "center", bgcolor: "#fff", borderRadius: 2, border: "1px dashed #b9d2c9" }}>
              <Stack direction="row" spacing={1.5} justifyContent="center" alignItems="center">
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  Analyzing symptoms, vitals and medical history to draft clinical notes…
                </Typography>
              </Stack>
            </Box>
          )}

          {/* Error Message */}
          {error && !loading && (
            <Alert
              severity="error"
              sx={{ mt: 1 }}
              action={
                <Button size="small" color="inherit" onClick={() => void generate()}>
                  Try again
                </Button>
              }
            >
              {error}
            </Alert>
          )}

          {/* Generated Draft Review Card */}
          {draft && !loading && (
            <Box sx={{ mt: 1.5, p: 2, bgcolor: "#fff", borderRadius: 2, border: "1px solid #d5e4dd" }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "primary.main" }}>
                  AI Generated Draft (Review before applying)
                </Typography>
                <Chip size="small" color="info" variant="outlined" label="Draft preview" />
              </Stack>

              <Stack spacing={1.5}>
                {FIELD_LABELS.filter(([key]) => Boolean(draft[key])).map(([key, label]) => (
                  <Box
                    key={key}
                    sx={{
                      p: 1.25,
                      borderRadius: 1.5,
                      bgcolor: appliedFields[key] ? "rgba(46,125,50,0.06)" : "#f8fbf9",
                      border: "1px solid",
                      borderColor: appliedFields[key] ? "#a5d6a7" : "#e6eeea",
                      transition: "all 0.15s ease-in-out",
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase" }}>
                        {label}
                      </Typography>
                      <Button
                        size="small"
                        variant={appliedFields[key] ? "text" : "outlined"}
                        color={appliedFields[key] ? "success" : "primary"}
                        startIcon={appliedFields[key] ? <IconCheck size={14} /> : undefined}
                        onClick={() => applySingleField(key)}
                        sx={{ height: 22, fontSize: "0.72rem", py: 0, px: 1 }}
                      >
                        {appliedFields[key] ? "Inserted" : `Insert ${label.split(" ")[0]}`}
                      </Button>
                    </Stack>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.5 }}>
                      {draft[key]}
                    </Typography>
                  </Box>
                ))}
              </Stack>

              {/* Action Buttons */}
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 2 }} flexWrap="wrap">
                <Button variant="contained" size="small" onClick={applyAll}>
                  Apply All into Notes
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<IconRefresh size={14} />}
                  onClick={() => void generate()}
                >
                  Regenerate
                </Button>
                <Button
                  size="small"
                  color="inherit"
                  startIcon={<IconTrash size={14} />}
                  onClick={() => {
                    setDraft(null);
                    setAppliedFields({});
                  }}
                >
                  Discard
                </Button>
              </Stack>
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
