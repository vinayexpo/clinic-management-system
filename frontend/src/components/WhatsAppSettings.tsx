import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
import { IconBrandWhatsapp, IconMessage, IconRefresh, IconSend } from "@tabler/icons-react";
import { whatsappApi, type WhatsAppMessageRow, type WhatsAppStatus } from "../api";
import { istDateTime } from "../lib/ist";
import { useLiveRefresh } from "../lib/realtime";
import { WHATSAPP_EVENT_LABELS, whatsappChatLink } from "../lib/whatsapp";
import { PagerBar, SearchField } from "./common";
import { WhatsAppCoexistence } from "./WhatsAppCoexistence";
import { WhatsAppTemplateEditor } from "./WhatsAppTemplateEditor";

const statusColor = (status: string): "success" | "warning" | "error" | "default" => {
  if (status === "sent") return "success";
  if (status === "failed") return "error";
  if (status === "logged") return "warning";
  return "default";
};

/**
 * WhatsApp connection, templates, test send and the message log.
 * Live delivery requires a Meta-approved template whose wording matches the clinic draft.
 */
export function WhatsAppSettings({ token, toast }: { token: string; toast: (message: string) => void }) {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [error, setError] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("This is a test message from your clinic.");
  const [messages, setMessages] = useState<WhatsAppMessageRow[]>([]);
  const [messagePage, setMessagePage] = useState(1);
  const [messagePerPage, setMessagePerPage] = useState(20);
  const [messageLastPage, setMessageLastPage] = useState(1);
  const [messageTotal, setMessageTotal] = useState(0);
  const [messageType, setMessageType] = useState("");
  const [messageStatus, setMessageStatus] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await whatsappApi.status(token);
      const data = (res as unknown as { data: WhatsAppStatus }).data;
      setStatus(data);
      setError("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load WhatsApp settings.");
    }
  }, [token]);

  const loadMessages = useCallback(async () => {
    try {
      const res = await whatsappApi.messages(token, {
        page: messagePage,
        per_page: messagePerPage,
        event: messageType || undefined,
        status: messageStatus || undefined,
        search: messageSearch.trim() || undefined,
      });
      const data = (res as unknown as { data: { data: WhatsAppMessageRow[]; last_page: number; total: number } }).data;
      setMessages(data.data);
      setMessageLastPage(data.last_page);
      setMessageTotal(data.total);
    } catch {
      setMessages([]);
    }
  }, [token, messagePage, messagePerPage, messageType, messageStatus, messageSearch]);

  useEffect(() => { void load(); void loadMessages(); }, [load, loadMessages]);
  useLiveRefresh(async () => { await Promise.all([load(), loadMessages()]); }, !!token);
  useEffect(() => { setMessagePage(1); }, [messagePerPage, messageType, messageStatus, messageSearch]);

  const sendTest = async () => {
    if (!status?.sender || status.sender.source !== "coexistence") {
      // No connected account: hand the message to WhatsApp instead of the API.
      const link = whatsappChatLink(testPhone, testMessage, status?.country_code ?? "91");
      if (!link) {
        setError("That phone number is not a valid international number.");
        return;
      }
      window.open(link, "_blank", "noopener,noreferrer");
      toast("WhatsApp opened. Send the message from your WhatsApp app.");
      return;
    }
    setSending(true); setError("");
    try {
      const res = await whatsappApi.sendTest(token, { phone: testPhone, message: testMessage });
      const data = (res as unknown as { data: { status: string; error: string | null } }).data;
      if (data.status === "failed") {
        setError(data.error ?? "The test message could not be sent.");
      } else {
        toast(data.status === "logged" ? "Test message logged (log-only mode)" : "Test message sent");
      }
      await loadMessages();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not send the test message.");
    } finally { setSending(false); }
  };

  return (
    <Card><CardContent>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
        <Box>
          <Typography variant="h5">WhatsApp reminders</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Remind patients about appointments and let them know when a prescription or bill is ready.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" justifyContent="flex-end">
          {status && <Chip icon={<IconMessage size={14} />} label={status.enabled ? (status.log_only ? "Enabled (log only)" : "Enabled") : "Disabled"} color={status.enabled ? (status.log_only ? "warning" : "success") : "default"} size="small" />}
          {status && <Chip label={status.coexistence.connection?.status === "connected" ? "Coexistence connected" : status.configured ? "API credentials configured" : "No business number"} color={status.coexistence.connection?.status === "connected" ? "success" : "default"} size="small" variant="outlined" />}
          {status && <Chip label={status.sender.source === "coexistence" ? `Sending from ${status.sender.phone_number ?? "Business app number"}` : status.sender.source === "standard" ? `Sending from ${status.sender.phone_number ?? "standard number"}` : "No sender"} color={status.sender.source ? "primary" : "default"} size="small" variant="outlined" />}
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

      {status && <WhatsAppCoexistence token={token} state={status.coexistence} onChanged={load} />}

      {status && !status.enabled && (
        <Alert severity="info" sx={{ mt: 2 }}>
          WhatsApp is turned off. Set WHATSAPP_ENABLED=true in the server environment to start sending reminders.
        </Alert>
      )}
      {status?.enabled && status.log_only && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          Log-only mode is on: messages are rendered and recorded but not delivered. Turn off WHATSAPP_LOG_ONLY once the business number and templates are approved.
        </Alert>
      )}
      {status?.enabled && !status.configured && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          No sender is available. Connect your existing Business app number using Meta Coexistence above, or set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN on the server.
        </Alert>
      )}
      {status?.sender.source === "standard" && (
        <Alert severity="info" sx={{ mt: 2 }}>
          Coexistence is not connected, so reminders and manual sends use the standard WhatsApp number set on the server.
        </Alert>
      )}

      {status && <WhatsAppTemplateEditor token={token} status={status} toast={toast} onChanged={load} />}

      <Divider sx={{ my: 2 }} />

      <Typography variant="subtitle2" sx={{ mb: 1 }}>Send a test message</Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "flex-start" }} flexWrap="wrap" useFlexGap>
        <TextField size="small" label="Phone number" value={testPhone} onChange={(e) => setTestPhone(e.target.value)}
          placeholder="+91 98765 43210" helperText={`International format. Country code ${status?.country_code ?? "91"}.`} sx={{ minWidth: 220 }} />
        <TextField size="small" label="Message" value={testMessage} onChange={(e) => setTestMessage(e.target.value)} sx={{ flex: 1, minWidth: 240 }} />
        <Button variant="outlined" onClick={() => void sendTest()} disabled={sending || !status?.enabled || !testPhone.trim() || !testMessage.trim()} startIcon={status?.sender.source === "coexistence" ? <IconSend size={16} /> : <IconBrandWhatsapp size={16} />}>
          {status?.sender.source === "coexistence" ? "Send test" : "Open WhatsApp"}
        </Button>
      </Stack>
      {!status?.log_only && status?.sender.source === "coexistence" && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        A live test needs the manual template approved by Meta with wording that matches the clinic draft.
      </Typography>}
      {status?.sender.source !== "coexistence" && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        The Business app is not connected, so this opens WhatsApp with the message ready for you to send.
      </Typography>}

      <Divider sx={{ my: 2 }} />

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">Recent messages</Typography>
        <Button size="small" startIcon={<IconRefresh size={14} />} onClick={() => void loadMessages()}>Refresh</Button>
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        <SearchField value={messageSearch} onChange={setMessageSearch} placeholder="Search message or number" />
        <TextField select size="small" label="Message type" value={messageType} onChange={(e) => setMessageType(e.target.value)} sx={{ minWidth: 170 }}>
          <MenuItem value="">All types</MenuItem>
          {Object.entries(WHATSAPP_EVENT_LABELS).map(([event, label]) => <MenuItem key={event} value={event}>{label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Status" value={messageStatus} onChange={(e) => setMessageStatus(e.target.value)} sx={{ minWidth: 140 }}>
          <MenuItem value="">All statuses</MenuItem>
          <MenuItem value="sent">Sent</MenuItem>
          <MenuItem value="logged">Logged</MenuItem>
          <MenuItem value="failed">Failed</MenuItem>
        </TextField>
      </Stack>
      {messages.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No WhatsApp messages match these filters.</Typography>
      ) : (
        <Box className="table-scroll">
          <Table size="small">
            <TableHead><TableRow><TableCell>When · IST</TableCell><TableCell>Type</TableCell><TableCell>To</TableCell><TableCell>Message</TableCell><TableCell>Status</TableCell></TableRow></TableHead>
            <TableBody>
              {messages.map((m) => (
                <TableRow key={m.id}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{m.sent_at ? istDateTime(m.sent_at) : istDateTime(m.created_at)}</TableCell>
                  <TableCell>{WHATSAPP_EVENT_LABELS[m.event] ?? m.event}</TableCell>
                  <TableCell className="mono">{m.to_number}</TableCell>
                  <TableCell sx={{ maxWidth: 320 }}><Typography variant="body2" sx={{ overflowWrap: "break-word" }}>{m.rendered_body}</Typography></TableCell>
                  <TableCell><Chip size="small" label={m.status} color={statusColor(m.status)} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      {messageTotal > 0 && (
        <PagerBar
          page={messagePage}
          lastPage={messageLastPage}
          total={messageTotal}
          perPage={messagePerPage}
          onPage={setMessagePage}
          onPerPage={(next) => { setMessagePerPage(next); setMessagePage(1); }}
        />
      )}
    </CardContent></Card>
  );
}
