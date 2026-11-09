import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { IconEye, IconEyeOff, IconRefresh, IconSparkles } from "@tabler/icons-react";
import { aiApi, type AiConfig, type AiFeature, type AiFeatureFlags, type AiModelRow } from "../api";
import { AI_EVENT, AI_FEATURE_LABELS } from "../lib/ai";
import { useLiveRefresh } from "../lib/realtime";

const FEATURE_KEYS: AiFeature[] = ["consultation", "prescription", "patient_summary", "assistant"];

/**
 * The administrator's AI setup card: API URL and key of an OpenAI-compatible
 * provider, the model chosen from that provider's live catalogue, and the
 * feature switches. The key is stored encrypted on the server and is shown
 * masked only.
 */
export function AISettings({ token, toast, onChanged }: { token: string; toast: (message: string) => void; onChanged: () => void }) {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<AiModelRow[]>([]);
  const [features, setFeatures] = useState<AiFeatureFlags>({ consultation: true, prescription: true, patient_summary: true, assistant: true });
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [modelsNote, setModelsNote] = useState("");
  const baseline = useRef("");
  const savedConfig = useRef("");
  const [stale, setStale] = useState(false);
  const local = useRef({ value: "", protected: false });
  local.current = { value: JSON.stringify([apiUrl, model, features]), protected: saving || fetching || !!apiKey };

  const load = useCallback(async () => {
    try {
      const res = await aiApi.config(token);
      const c = res.data;
      if (local.current.protected || (baseline.current && local.current.value !== baseline.current)) {
        setStale(JSON.stringify(c) !== savedConfig.current);
        return;
      }
      baseline.current = JSON.stringify([c.base_url ?? "", c.model ?? "", c.features]);
      savedConfig.current = JSON.stringify(c);
      setStale(false);
      setConfig(c);
      setApiUrl(c.base_url ?? "");
      setModel(c.model ?? "");
      setFeatures(c.features);
      if (c.base_url === null) setApiUrl("");
      if (c.model === null) setModel("");
      setModels(c.base_url ? [{ id: c.model ?? "", owned_by: null }] : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load AI settings.");
    } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load, !!token);

  const configured = Boolean(config?.has_api_key && config?.base_url && config?.model);

  /** Live model catalogue from the provider. Blank fields fall back to the saved ones. */
  const fetchModels = async () => {
    setFetching(true); setError(""); setModelsNote("");
    try {
      const res = await aiApi.models(token, { api_url: apiUrl.trim() || undefined, api_key: apiKey.trim() || undefined });
      const list = res.data.models;
      setModels(list);
      if (!model.trim() && list.length > 0) {
        setModel(list[0].id);
        setModelsNote(`${list.length} models found. ${list[0].id} selected — review it and save.`);
      } else {
        setModelsNote(`${list.length} models found from ${res.data.resolved_url}.`);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not fetch the model list.");
    } finally { setFetching(false); }
  };

  const save = async () => {
    setSaving(true); setError("");
    try {
      const res = await aiApi.saveConfig(token, {
        base_url: apiUrl.trim(),
        api_key: apiKey.trim() || undefined,
        model: model.trim(),
        features,
      });
      const c = res.data;
      setConfig(c);
      baseline.current = JSON.stringify([apiUrl, model, features]);
      savedConfig.current = JSON.stringify(c);
      setStale(false);
      setApiKey("");
      toast("AI settings saved");
      setModelsNote(`Saved. ${c.model} will be used for drafts.`);
      onChanged();
      window.dispatchEvent(new CustomEvent(AI_EVENT));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save AI settings.");
    } finally { setSaving(false); }
  };

  const modelOptions = Array.from(new Set([...models.map((m) => m.id), ...((model.trim() ? [model.trim()] : []))])).filter(Boolean);

  return (
    <Card><CardContent>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
        <Box>
          <Typography component="h2" variant="h5">AI assistant</Typography>
        </Box>
        <Chip
          icon={<IconSparkles size={15} />}
          label={configured ? `Connected · ${config?.model}` : "Not set up"}
          color={configured ? "success" : "default"}
          size="small"
        />
      </Stack>

      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {stale && <Alert severity="warning" sx={{ mt: 2 }}>AI settings changed elsewhere. Your edits and key are kept. Reopen settings to load the saved version before saving.</Alert>}
      {modelsNote && !error && <Alert severity="info" sx={{ mt: 2 }}>{modelsNote}</Alert>}
      {loading && <Box sx={{ py: 2 }}><CircularProgress size={22} /></Box>}

      {!loading && (
        <>
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary", display: "block", mb: 0.75 }}>
              Quick Provider Presets
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {[
                { name: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-1.5-flash" },
                { name: "OpenAI", url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
                { name: "Groq", url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
                { name: "DeepSeek", url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
                { name: "OpenRouter", url: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
              ].map((preset) => (
                <Chip
                  key={preset.name}
                  size="small"
                  variant={apiUrl === preset.url ? "filled" : "outlined"}
                  color={apiUrl === preset.url ? "primary" : "default"}
                  label={preset.name}
                  onClick={() => {
                    setApiUrl(preset.url);
                    if (!model.trim() || models.length === 0) setModel(preset.model);
                  }}
                  sx={{ cursor: "pointer", fontSize: "0.75rem" }}
                />
              ))}
            </Stack>
          </Box>

          <TextField
            fullWidth
            label="API URL"
            placeholder="https://api.openai.com/v1"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            helperText="Any OpenAI-compatible service endpoint."
            sx={{ mt: 2 }}
          />
          <TextField
            fullWidth
            type={showKey ? "text" : "password"}
            label="API key"
            placeholder={config?.has_api_key ? `Saved key on file (${config.api_key_masked ?? "key exists"}) — leave empty to keep it` : "sk-..."}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="new-password"
            sx={{ mt: 2 }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Hide API key" : "Show API key"}>
                    {showKey ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
            helperText="Encrypted on the server; leave empty to keep it."
          />

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "flex-start" }} sx={{ mt: 2 }}>
            <Autocomplete
              freeSolo
              options={modelOptions}
              value={model.trim()}
              disableClearable
              onInputChange={(_, value, reason) => {
                if (reason !== "reset" || value !== "") setModel(value);
              }}
              onChange={(_, value) => setModel((value as string | null) ?? "")}
              renderInput={(params) => <TextField {...params} label="Model" helperText="Fetch the list, or type an id." sx={{ flex: 1, minWidth: { sm: 260 } }} />}
            />
            <Button
              variant="outlined"
              startIcon={fetching ? <CircularProgress size={16} color="inherit" /> : <IconRefresh size={16} />}
              disabled={fetching || (!apiUrl.trim() && !config?.base_url)}
              onClick={() => void fetchModels()}
              sx={{ mt: { xs: 1, sm: 0 } }}
            >
              {modelOptions.length > 0 ? "Re-fetch models" : "Fetch models"}
            </Button>
          </Stack>

          <Divider sx={{ my: 2.5 }} />
          <Box sx={{ mt: 1 }}>
            {FEATURE_KEYS.map((key) => (
              <FormControlLabel
                key={key}
                sx={{ display: "flex" }}
                control={<Switch checked={features[key]} onChange={(e) => setFeatures((f) => ({ ...f, [key]: e.target.checked }))} />}
                label={<Typography variant="body2">{AI_FEATURE_LABELS[key]}</Typography>}
              />
            ))}
          </Box>

          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <IconSparkles size={16} />}
              disabled={saving || !apiUrl.trim() || !model.trim()}
              onClick={() => void save()}
            >
              {saving ? "Saving..." : "Save AI settings"}
            </Button>
          </Stack>
        </>
      )}
    </CardContent></Card>
  );
}
