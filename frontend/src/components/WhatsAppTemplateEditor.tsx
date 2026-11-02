import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { IconCheck, IconDownload, IconRefresh, IconUpload } from "@tabler/icons-react";
import { whatsappApi, type WhatsAppMetaCatalog, type WhatsAppMetaTemplateRow, type WhatsAppStatus, type WhatsAppTemplateRow } from "../api";
import { istDateTime } from "../lib/ist";
import { useLiveRefresh } from "../lib/realtime";
import { WHATSAPP_EVENT_LABELS, WHATSAPP_SYNC_LABELS, WHATSAPP_VARIABLES, metaStatusColor, syncColor } from "../lib/whatsapp";

type Busy = "pull" | "save" | "adopt" | "publish" | "unlink" | null;

const fieldSx = { "& .MuiInputBase-input": { minHeight: 44, boxSizing: "border-box" } };
const selectSx = { "& .MuiSelect-select": { minHeight: 44, boxSizing: "border-box", display: "flex", alignItems: "center" } };

/**
 * Clinic event templates and their explicit two-way synchronization with Meta.
 * Local edits are saved as drafts; nothing is submitted or imported without a click.
 */
export function WhatsAppTemplateEditor({ token, status, toast, onChanged }: {
  token: string;
  status: WhatsAppStatus;
  toast: (message: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [catalog, setCatalog] = useState<WhatsAppMetaCatalog | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [selected, setSelected] = useState("appointment_reminder");
  const [draftName, setDraftName] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [preview, setPreview] = useState<{ body: string; parameters: string[] } | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importId, setImportId] = useState<number | "">("");
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [mediaUrl, setMediaUrl] = useState("");
  const [headerType, setHeaderType] = useState<"IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT">("IMAGE");
  const [headerSample, setHeaderSample] = useState("");

  const latest = status.templates.find((template) => template.event === selected) ?? null;
  const [current, setCurrent] = useState<WhatsAppTemplateRow | null>(latest);
  const [stale, setStale] = useState(false);
  const [catalogStale, setCatalogStale] = useState(false);
  const selectedBaseline = useRef("");
  const dirty = !!current && (draftName !== current.template_name || draftBody !== current.body || mediaUrl !== (current.media_url ?? ""));
  const editor = useRef({ dirty, busy, importId, headerSample, headerType, catalog });
  editor.current = { dirty, busy, importId, headerSample, headerType, catalog };
  const conflict = current?.sync_state === "conflict";

  const loadCatalog = useCallback(async () => {
    try {
      const res = await whatsappApi.metaTemplates(token);
      if (editor.current.importId !== "" && editor.current.catalog && JSON.stringify(res.data) !== JSON.stringify(editor.current.catalog)) {
        setCatalogStale(true);
        return;
      }
      setCatalog(res.data);
      setCatalogStale(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load Meta templates.");
    }
  }, [token]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useLiveRefresh(loadCatalog, !!token);

  useEffect(() => {
    if (!latest) {
      if (selectedBaseline.current === selected && current) setStale(true);
      return;
    }
    const local = editor.current;
    if (selectedBaseline.current === selected && (local.dirty || local.busy || local.importId !== "" || local.headerSample || local.headerType !== "IMAGE")) {
      setStale(JSON.stringify(latest) !== JSON.stringify(current));
      return;
    }
    selectedBaseline.current = selected;
    setCurrent(latest);
    setDraftName(latest.template_name);
    setDraftBody(latest.body);
    setMediaUrl(latest.media_url ?? "");
    setStale(false);
    let alive = true;
    void whatsappApi.preview(token, selected)
      .then((res) => { if (alive) setPreview(res.data); })
      .catch(() => { if (alive) setPreview(null); });
    return () => { alive = false; };
    // Only reload the draft when the selected type or its saved version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, latest, token, busy]);

  const refresh = async () => {
    await onChanged();
    await loadCatalog();
  };

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<string>) => {
    setBusy(kind); setError("");
    try {
      toast(await action());
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "That action did not complete.");
    } finally { setBusy(null); }
  };

  const pull = () => run("pull", async () => {
    const res = await whatsappApi.pullMetaTemplates(token);
    return `Pulled Meta templates: ${res.data.imported} new, ${res.data.updated} updated, ${res.data.conflicts} conflicts`;
  });

  const saveDraft = () => {
    if (!current) return;
    return run("save", async () => {
      const res = await whatsappApi.updateTemplate(token, selected, {
        template_name: draftName.trim(), body: draftBody, is_active: current.is_active,
        media_url: mediaUrl.trim() || null, expected_revision: current.revision,
      });
      setCurrent(res.data);
      setStale(false);
      return "Draft saved";
    });
  };

  const publish = () => {
    if (!current) return;
    return run("publish", async () => {
      const res = await whatsappApi.publishTemplate(token, selected, {
        expected_revision: current.revision,
        resolve: conflict ? "keep_local" : undefined,
        header: current.meta_template_id
          ? undefined
          : headerSample.trim() ? { type: headerType, sample: headerSample.trim() } : null,
      });
      return res.data.message;
    });
  };

  const unlink = () => {
    if (!current?.meta_template_id) return;
    return run("unlink", async () => {
      await whatsappApi.unlinkTemplate(token, selected);
      return "Unlinked from Meta";
    });
  };

  const importTemplate = catalog?.templates.find((template) => template.id === importId) ?? null;  const importable = (catalog?.templates ?? []).filter((template) => template.supported && !template.missing);
  const mappingComplete = !!importTemplate && importTemplate.placeholders.every((key) => Boolean(bindings[key]));
  const mediaHeader = current?.header_type && ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"].includes(current.header_type)
    ? current.header_type
    : null;

  const chooseImport = (id: number | "") => {
    setImportId(id);
    if (id === "") { setBindings({}); return; }
    const template = catalog?.templates.find((row) => row.id === id);
    if (!template) return;
    const next: Record<string, string> = {};
    template.placeholders.forEach((key, index) => {
      const previous = current?.bindings.find((binding) => binding.key === key)?.variable;
      next[key] = previous ?? current?.placeholders[index] ?? WHATSAPP_VARIABLES[index] ?? WHATSAPP_VARIABLES[0];
    });
    setBindings(next);
    setShowImport(true);
  };

  const adopt = () => {
    if (!current || !importTemplate || !mappingComplete) return;
    return run("adopt", async () => {
      const res = await whatsappApi.adoptTemplate(token, selected, {
        meta_template_id: importTemplate.id,
        expected_revision: current.revision,
        bindings: Object.fromEntries(importTemplate.placeholders.map((key) => [key, bindings[key]])),
      });
      setCurrent(res.data);
      setDraftName(res.data.template_name);
      setDraftBody(res.data.body);
      setMediaUrl(res.data.media_url ?? "");
      setImportId("");
      setStale(false);
      setShowImport(false);
      return "Imported Meta wording";
    });
  };


  return (
    <Box component="section" aria-labelledby="whatsapp-templates-title">
      <Divider sx={{ my: 2 }} />
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "flex-start" }} spacing={1.5}>
        <Box>
          <Typography id="whatsapp-templates-title" variant="h6">Message templates</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Edit wording and sync it with Meta.</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="caption" color="text.secondary">
            {catalog?.last_pulled_at ? `Last pulled ${istDateTime(catalog.last_pulled_at)}` : "Not pulled yet"}
          </Typography>
          <Button size="small" variant="outlined" startIcon={busy === "pull" ? <CircularProgress size={14} /> : <IconDownload size={15} />}
            disabled={!!busy || !status.configured} onClick={() => void pull()}>
            {busy === "pull" ? "Pulling..." : "Pull from Meta"}
          </Button>
        </Stack>
      </Stack>
      {!status.configured && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Connect a WhatsApp number to sync templates.</Typography>}
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {stale && <Alert severity="warning" sx={{ mt: 2 }}>Template changed elsewhere. Your edits are kept. Switch message types to reload.</Alert>}
      {catalogStale && <Alert severity="warning" sx={{ mt: 2 }}>Catalog changed. Clear your import selection, then refresh.</Alert>}

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mt: 2 }}>
        <Box component="nav" aria-label="Message type" sx={{ flex: "0 0 220px" }}>
          <Stack spacing={0.5}>
            {Object.entries(WHATSAPP_EVENT_LABELS).map(([event, label]) => {
              const row = status.templates.find((template) => template.event === event);
              return <Box key={event} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Button size="small" variant={selected === event ? "contained" : "text"} onClick={() => { setSelected(event); setShowImport(false); }}
                  sx={{ justifyContent: "flex-start", flex: 1 }} aria-current={selected === event ? "true" : undefined}>
                  {label}
                </Button>
                {row && row.sync_state !== "local" && <Box aria-label={WHATSAPP_SYNC_LABELS[row.sync_state] ?? row.sync_state} sx={{
                  width: 8, height: 8, borderRadius: "50%", flex: "0 0 auto",
                  bgcolor: row.sync_state === "synced" ? "success.main" : row.sync_state === "conflict" || row.sync_state === "missing" ? "error.main" : "warning.main",
                }} />}
              </Box>;
            })}
          </Stack>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          {current && <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{WHATSAPP_EVENT_LABELS[selected]}</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
              <Chip size="small" label={WHATSAPP_SYNC_LABELS[current.sync_state] ?? current.sync_state} color={syncColor(current.sync_state)} />
              {current.meta_status && <Chip size="small" variant="outlined" label={`Meta ${current.meta_status.toLowerCase()}`} color={metaStatusColor(current.meta_status)} />}
              {current.meta_template_id && <Chip size="small" variant="outlined" label={`${current.language} · ${current.meta_template_id}`} />}
            </Stack>

            {conflict && <Alert severity="error" sx={{ mb: 2 }}>
              Meta and the clinic both changed this template. Import Meta's wording or submit the clinic draft.
            </Alert>}
            {current.sync_state === "uncertain" && <Alert severity="warning" sx={{ mb: 2 }}>
              <Typography variant="body2">{current.sync_error ?? "A submit was not confirmed. Pull from Meta before submitting again."}</Typography>
              <Button size="small" color="inherit" sx={{ mt: 1 }} onClick={() => void pull()}>Pull from Meta</Button>
            </Alert>}
            {current.meta_missing && <Alert severity="warning" sx={{ mb: 2 }}>This template is missing from the Meta catalog. Pull from Meta or choose another template.</Alert>}
            {current.meta_status === "PENDING" && !conflict && <Alert severity="info" sx={{ mb: 2 }}>Live reminders wait for Meta approval.</Alert>}
            {current.meta_status === "REJECTED" && <Alert severity="error" sx={{ mb: 2 }}>Meta rejected this template. Edit the wording, then submit it again.</Alert>}
            {current.sync_state === "draft" && <Alert severity="info" sx={{ mb: 2 }}>The clinic wording differs from Meta. Live reminders use the approved Meta wording only.</Alert>}

            <TextField fullWidth size="small" sx={{ ...fieldSx, mb: 2 }} label="Template name" value={draftName} onChange={(event) => setDraftName(event.target.value)}
              helperText="Lowercase letters, numbers, underscores. Submitted names cannot change." />
            <TextField fullWidth size="small" sx={{ ...fieldSx, mb: 2 }} multiline minRows={3} label="Message body" value={draftBody} onChange={(event) => setDraftBody(event.target.value)}
              helperText={`Placeholders: ${WHATSAPP_VARIABLES.map((variable) => `{{${variable}}}`).join(", ")}`} />
            {preview && <Box sx={{ p: 1.5, mb: 2, borderRadius: 2, bgcolor: "action.hover" }}>
              <Typography variant="caption" color="text.secondary">Preview</Typography>
              <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{preview.body}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                {preview.parameters.length} template parameter{preview.parameters.length === 1 ? "" : "s"}
              </Typography>
            </Box>}
            {mediaHeader && <Box sx={{ mb: 2 }}>
              <Alert severity="info" sx={{ mb: 1.5 }}>
                This template sends {/^[aeiou]/i.test(mediaHeader) ? "an" : "a"} {mediaHeader.toLowerCase()} header. Add the public link to use when the message goes out.
              </Alert>
              <TextField fullWidth size="small" sx={fieldSx} label={`${mediaHeader.charAt(0)}${mediaHeader.slice(1).toLowerCase()} link`}
                value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)}
                placeholder="https://example.com/file.pdf"
                helperText="A public link Meta can fetch. Leave empty to block automatic sending of this template." />
            </Box>}
            {!current.meta_template_id && <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Media header (optional)</Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <TextField select size="small" sx={{ ...selectSx, minWidth: 150 }} label="Type" value={headerType}
                  onChange={(event) => setHeaderType(event.target.value as typeof headerType)}>
                  <MenuItem value="IMAGE">Photo</MenuItem>
                  <MenuItem value="VIDEO">Video</MenuItem>
                  <MenuItem value="AUDIO">Audio</MenuItem>
                  <MenuItem value="DOCUMENT">Document</MenuItem>
                </TextField>
                <TextField fullWidth size="small" sx={fieldSx} label="Sample link for Meta's review" value={headerSample}
                  onChange={(event) => setHeaderSample(event.target.value)} placeholder="https://example.com/image.png"
                  helperText="Meta needs a public example to review the header." />
              </Stack>
            </Box>}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button variant="outlined" onClick={() => void saveDraft()} disabled={!!busy || !draftName.trim() || !draftBody.trim()}
                startIcon={busy === "save" ? <CircularProgress size={16} /> : <IconCheck size={16} />}>
                {busy === "save" ? "Saving..." : "Save draft"}
              </Button>
              <Button variant="contained" onClick={() => void publish()} disabled={!!busy || dirty || current.sync_state === "uncertain"}
                startIcon={busy === "publish" ? <CircularProgress size={16} /> : <IconUpload size={16} />}>
                {busy === "publish" ? "Submitting..." : conflict ? "Keep clinic wording and submit" : "Submit to Meta"}
              </Button>
            </Stack>
            {dirty && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Save the draft before submitting.</Typography>}
            {current.meta_template_id && (
              <Box sx={{ mt: 1.5 }}>
                <Button size="small" color="error" onClick={() => void unlink()} disabled={!!busy || stale}>
                  Unlink from Meta
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                  The template stays in your Meta account; this message type stops using it.
                </Typography>
              </Box>
            )}
          </>}

          <Box sx={{ mt: 2 }}>
            <Button size="small" variant="text" onClick={() => setShowImport((open) => !open)} aria-expanded={showImport} aria-controls="whatsapp-import-panel">
              {showImport ? "Hide import" : "Import Meta wording"}
            </Button>
            <Collapse in={showImport} timeout="auto">
              <Box id="whatsapp-import-panel" sx={{ mt: 1, p: 2, border: 1, borderColor: "divider", borderRadius: 2 }}>
                <TextField select fullWidth size="small" sx={selectSx} label="Meta template" value={importId}
                  onChange={(event) => chooseImport(event.target.value === "" ? "" : Number(event.target.value))}
                  helperText={importable.length === 0 ? "Pull from Meta first. Templates this system cannot map are listed in the catalog below." : "Every template Meta offers can be imported, including photo, video, audio and button templates."}>
                  <MenuItem value="">Choose a template</MenuItem>
                  {importable.map((template) => <MenuItem key={template.id} value={template.id}>
                    {template.name} · {template.language} · {template.status ?? "unknown"}
                  </MenuItem>)}
                </TextField>

                {importTemplate && <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{importTemplate.body}</Typography>
                  {importTemplate.footer && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Footer: {importTemplate.footer}</Typography>}
                  {importTemplate.header_type && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                    Header: {importTemplate.header_type.toLowerCase()}
                    {importTemplate.button_parameter_count > 0 ? " · a button needs a value, so it is not sent automatically" : ""}
                  </Typography>}
                  {importTemplate.buttons.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                    Buttons: {importTemplate.buttons.map((button) => button.text || button.type).join(", ")}
                  </Typography>}
                  {importTemplate.placeholders.length > 0 && <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>Map Meta parameters to clinic data</Typography>
                    <Stack spacing={1.5}>
                      {importTemplate.placeholders.map((key) => <TextField key={key} select fullWidth size="small" sx={selectSx}
                        label={`Parameter {{${key}}}`} value={bindings[key] ?? ""}
                        onChange={(event) => setBindings((previous) => ({ ...previous, [key]: event.target.value }))}>
                        {WHATSAPP_VARIABLES.map((variable) => <MenuItem key={variable} value={variable}>{variable}</MenuItem>)}
                      </TextField>)}
                    </Stack>
                  </Box>}
                  {importTemplate.category && importTemplate.category !== "UTILITY" && <Alert severity="warning" sx={{ mt: 2 }}>
                    This template is {importTemplate.category}. Reminders should use utility templates.
                  </Alert>}
                  <Button variant="contained" sx={{ mt: 2 }} onClick={() => void adopt()} disabled={!!busy || (importTemplate.placeholders.length > 0 && !mappingComplete)}
                    startIcon={busy === "adopt" ? <CircularProgress size={16} /> : <IconDownload size={16} />}>
                    {busy === "adopt" ? "Importing..." : "Use this Meta wording"}
                  </Button>
                  {current?.meta_template_id === importTemplate.meta_id && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                    This replaces the clinic draft with Meta's current content.
                  </Typography>}
                </Box>}
              </Box>
            </Collapse>
          </Box>
        </Box>
      </Stack>

      <Box sx={{ mt: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle2">Meta template catalog</Typography>
          <Button size="small" startIcon={<IconRefresh size={14} />} onClick={() => void loadCatalog()} disabled={!!busy}>Refresh catalog</Button>
        </Stack>
        {!catalog || catalog.templates.length === 0 ? <Typography variant="body2" color="text.secondary">
          {status.configured ? "No Meta templates loaded. Pull from Meta to see them." : "Connect a WhatsApp number, then pull the catalog."}
        </Typography> : <Box className="table-scroll">
          <Table size="small">
            <TableHead><TableRow>
              <TableCell>Template</TableCell><TableCell>Header</TableCell><TableCell>Buttons</TableCell>
              <TableCell>Language</TableCell><TableCell>Category</TableCell>
              <TableCell>Status</TableCell><TableCell>Parameters</TableCell><TableCell>Clinic message type</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {catalog.templates.map((template: WhatsAppMetaTemplateRow) => <TableRow key={template.id}>
                <TableCell sx={{ minWidth: 200 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{template.name}</Typography>
                  {!template.supported && <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{template.unsupported_reason}</Typography>}
                  {template.missing && <Chip size="small" color="error" label="Missing in Meta" sx={{ mt: 0.5 }} />}
                </TableCell>
                <TableCell>{template.header_type ? template.header_type.toLowerCase() : "—"}</TableCell>
                <TableCell>{template.buttons.length === 0 ? "—" : `${template.buttons.length}${template.button_parameter_count > 0 ? " (needs a value)" : ""}`}</TableCell>
                <TableCell className="mono">{template.language}</TableCell>
                <TableCell>{template.category ?? "—"}</TableCell>
                <TableCell><Chip size="small" variant="outlined" label={template.status ?? "unknown"} color={metaStatusColor(template.status)} /></TableCell>
                <TableCell>{template.placeholders.length === 0 ? "None" : template.placeholders.map((key) => `{{${key}}}`).join(" ")}</TableCell>
                <TableCell>{template.linked_event ? WHATSAPP_EVENT_LABELS[template.linked_event] ?? template.linked_event : "Not linked"}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </Box>}
      </Box>
    </Box>
  );
}
