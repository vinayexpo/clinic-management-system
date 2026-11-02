import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Checkbox, FormControlLabel, Stack, TextField, Typography } from "@mui/material";
import { whatsappApi, type Paginated, type WhatsAppSignupAttempt, type WhatsAppStatus, type WhatsAppSyncEvent } from "../api";
import { launchWhatsAppSignup, prepareWhatsAppSignup } from "../lib/whatsappCoexistence";
import { istDateTime } from "../lib/ist";
import { useLiveRefresh } from "../lib/realtime";

export function WhatsAppCoexistence({ token, state, onChanged }: { token: string; state: WhatsAppStatus["coexistence"]; onChanged: () => Promise<void> }) {
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [attempt, setAttempt] = useState<WhatsAppSignupAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [showReconnect, setShowReconnect] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [events, setEvents] = useState<Paginated<WhatsAppSyncEvent> | null>(null);
  const [eventsBusy, setEventsBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort(); }; }, []);
  const connection = state.connection;
  useLiveRefresh(async () => {
    if (!events || eventsBusy) return;
    const response = await whatsappApi.syncEvents(token, events.current_page);
    if (mounted.current) setEvents(response.data);
  }, !!token);

  const prepare = async () => {
    active.current = null;
    setBusy(true); setError(""); setSuccess(false); setAttempt(null);
    try {
      const response = await whatsappApi.startCoexistence(token, phone, consent);
      await prepareWhatsAppSignup(response.data);
      if (mounted.current) setAttempt(response.data);
    } catch (e: unknown) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Could not prepare Meta signup.");
    } finally { if (mounted.current) setBusy(false); }
  };

  const connect = () => {
    if (!attempt) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError("");
    void launchWhatsAppSignup(attempt, controller.signal).then(async (result) => {
      if (controller.signal.aborted) return;
      active.current = null;
      setFinalizing(true);
      await whatsappApi.completeCoexistence(token, { ...result, state: attempt.state });
      if (mounted.current) { setSuccess(true); setShowReconnect(false); }
    }).catch((e: unknown) => {
      if (mounted.current) setError(e instanceof Error ? e.message : "Could not connect WhatsApp.");
    }).finally(async () => {
      active.current = null;
      if (mounted.current) { setBusy(false); setFinalizing(false); setAttempt(null); await onChanged(); }
    });
  };

  const loadEvents = async (page = 1) => {
    setEventsBusy(true); setError("");
    try {
      const response = await whatsappApi.syncEvents(token, page);
      setEvents(response.data);
      await onChanged();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not load synced messages."); }
    finally { setEventsBusy(false); }
  };

  return <Box component="section" aria-labelledby="whatsapp-coexistence-title" sx={{ mt: 2 }}>
    <Typography id="whatsapp-coexistence-title" component="h3" variant="h6">Keep your WhatsApp Business app</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Use your existing number.</Typography>
    {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
    {success && <Alert severity="success" sx={{ mt: 2 }}>Meta verified your existing number. Data synchronization has been requested; delivery settings are unchanged.</Alert>}
    {connection && <Box sx={{ mt: 2 }}>
      <Typography variant="body2">Coexistence {connection.status.replace(/_/g, " ")}: {connection.display_phone_number}</Typography>
      <Typography variant="body2" color="text.secondary">Chat import: {connection.history_status.replace(/_/g, " ")}{connection.sync_progress > 0 ? ` (${connection.sync_progress}%)` : ""}</Typography>
      <Typography variant="caption" color="text.secondary">{connection.last_webhook_at ? `Last update: ${istDateTime(connection.last_webhook_at)}` : "Waiting for Meta webhook updates."}</Typography>
      <Button size="small" onClick={() => void onChanged()}>Refresh connection</Button>
      {[connection.contacts_sync_request_id, connection.history_sync_request_id].includes("pending_confirmation") && <Alert severity="warning" sx={{ mt: 1 }}>Meta has not confirmed an import request. Contact Meta support before retrying; this system will not repeat an unconfirmed import.</Alert>}
      {[connection.contacts_sync_request_id, connection.history_sync_request_id].includes("rejected") && <Alert severity="warning" sx={{ mt: 1 }}>Meta rejected an import request. Resolve the issue in Meta, then reconnect to retry only rejected imports.</Alert>}
    </Box>}
    {connection && <Box component="details" sx={{ mt: 2 }} onToggle={(event) => { if (event.currentTarget.open && !events && !eventsBusy) void loadEvents(); }}>
      <Box component="summary" sx={{ cursor: "pointer", minHeight: 44, alignContent: "center" }}>Synced messages and updates</Box>
      {eventsBusy && <Typography variant="body2" role="status">Loading synced updates...</Typography>}
      {events?.data.length === 0 && <Typography variant="body2" sx={{ mt: 1 }}>No synced updates received yet. Keep the Business app open and check the webhook configuration.</Typography>}
      {events?.data.map((event) => <Box key={event.id} sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="caption" color="text.secondary">{istDateTime(event.received_at)} | {({ smb_message_echoes: "Business app messages", smb_app_state_sync: "Contact updates", history: "Chat history", messages: "Messages and delivery updates", account_update: "Account status" } as Record<string, string>)[event.field] ?? "WhatsApp update"}</Typography>
        {event.messages.map((message, index) => <Box key={index} sx={{ mt: 1 }}>
          <Typography variant="body2">{message.direction === "outgoing" ? "To" : "From"} {message.peer_number}</Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message.body || `[${message.type || "Unsupported"} message]`}</Typography>
        </Box>)}
        {event.message_count > event.messages.length && <Typography variant="caption">Showing {event.messages.length} of {event.message_count} messages in this update.</Typography>}
        {event.contact_count > 0 && <Typography variant="body2">{event.contact_count} contact updates received. No patient records were created.</Typography>}
        {event.status_count > 0 && <Typography variant="body2">{event.status_count} delivery status updates received.</Typography>}
      </Box>)}
      {events && <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Button disabled={eventsBusy || events.current_page <= 1} onClick={() => void loadEvents(events.current_page - 1)}>Previous updates</Button>
        <Button disabled={eventsBusy || events.current_page >= events.last_page} onClick={() => void loadEvents(events.current_page + 1)}>Next updates</Button>
        <Button disabled={eventsBusy} onClick={() => void loadEvents(events.current_page)}>Refresh updates</Button>
      </Stack>}
    </Box>}
    {!state.ready ? <Alert severity="info" sx={{ mt: 2 }}>Connection setup is required on the server. Your existing Business app is unchanged.</Alert> : connection?.status === "connected" && !showReconnect ? <Button variant="outlined" sx={{ mt: 2 }} onClick={() => setShowReconnect(true)}>Reconnect number</Button> : <Box sx={{ mt: 2 }}>
      <TextField fullWidth size="small" sx={{ "& .MuiInputBase-input": { minHeight: 44, boxSizing: "border-box" } }} label="Business app number" placeholder="+919876543210" helperText="Include +country code." value={phone} disabled={busy || !!attempt} onChange={(e) => setPhone(e.target.value)} inputProps={{ inputMode: "tel" }} />
      <FormControlLabel sx={{ mt: 1, alignItems: "flex-start" }} control={<Checkbox sx={{ p: 1.25 }} checked={consent} disabled={busy || !!attempt} onChange={(e) => setConsent(e.target.checked)} />} label={<Typography variant="body2" sx={{ pt: 1 }}>Import contacts and chats I share in Meta.</Typography>} />
      {attempt && <Alert severity="info" sx={{ my: 1 }}>Choose your existing Business app number in Meta. Keep the Business app open during setup.</Alert>}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1 }}>
        <Button variant="contained" disabled={busy || (!attempt && (!consent || !/^\+[1-9][0-9]{7,14}$/.test(phone)))} onClick={attempt ? connect : () => void prepare()}>{finalizing ? "Saving connection..." : busy ? "Connecting..." : attempt ? "Continue with Meta" : connection ? "Reconnect with Meta" : "Prepare Meta connection"}</Button>
        {busy && active.current && <Button onClick={() => active.current?.abort()}>Cancel connection</Button>}
        {attempt && !busy && <Button onClick={() => setAttempt(null)}>Change number</Button>}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Meta eligibility and messaging charges apply.</Typography>
    </Box>}
    <Box component="details" sx={{ mt: 2, overflowWrap: "anywhere" }}>
      <Box component="summary" sx={{ cursor: "pointer", minHeight: 44, alignContent: "center" }}>Connection requirements</Box>
      <Typography variant="body2" sx={{ mt: 1 }}>Use an approved Meta Tech Provider or Solution Partner app with an Embedded Signup v4 configuration and WhatsApp permissions.</Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>Configure a public HTTPS webhook, app ID, app secret, signup configuration ID, and webhook verification token on the server. Enable WHATSAPP_COEXISTENCE_READY only after Meta verifies the callback.</Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>Callback: {state.webhook_url}</Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>Webhook fields: {state.required_webhook_fields.join(", ")}</Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>Keep the Business app installed and active. Meta may unlink companion devices and change some app features. Disconnect through Business app Settings, Account, Business Platform.</Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>API reminders still require patient consent and Meta-approved templates. Connecting a number does not turn on delivery or disable log-only mode.</Typography>
      <Button component="a" href="https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users/" target="_blank" rel="noopener noreferrer" size="small">Meta Coexistence guide</Button>
    </Box>
  </Box>;
}
