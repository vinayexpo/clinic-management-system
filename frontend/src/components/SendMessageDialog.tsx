import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { IconBrandWhatsapp, IconSend } from "@tabler/icons-react";
import { whatsappApi, type PatientRow } from "../api";
import { whatsappChatLink } from "../lib/whatsapp";

const MAX_LENGTH = 1000;

/**
 * Sends a message to a patient.
 *
 * With the Business app connected, the message goes out through the API using the
 * approved manual template. Without it, the dialog hands the message to WhatsApp
 * so the staff member can send it from their own WhatsApp app.
 */
export function SendMessageDialog({ token, patient, mode, countryCode, onClose, onSent, toast }: {
  token: string;
  patient: PatientRow;
  mode: "api" | "link";
  countryCode: string;
  onClose: () => void;
  onSent: () => Promise<void> | void;
  toast: (message: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isApi = mode === "api";
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ");

  const openInWhatsApp = () => {
    const link = whatsappChatLink(patient.phone, message, countryCode);
    if (!link) {
      setError("This patient has no usable phone number.");
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
    toast("WhatsApp opened. Send the message from your WhatsApp app.");
    onClose();
  };

  const send = async () => {
    if (!isApi) {
      openInWhatsApp();
      return;
    }
    setBusy(true); setError("");
    try {
      const res = await whatsappApi.sendToPatient(token, { patient_id: patient.id, message: message.trim() });
      const data = (res as unknown as { data: { status: string; error: string | null } }).data;
      if (data.status === "sent") {
        toast("WhatsApp message sent");
        await onSent();
        onClose();
        return;
      }
      if (data.status === "logged") {
        toast("Message recorded. Log-only mode is on, so it was not delivered.");
        await onSent();
        onClose();
        return;
      }
      setError(data.error ?? "The message could not be sent.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "The message could not be sent.");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isApi ? "Send WhatsApp message" : "Message on WhatsApp"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          {isApi ? (
            !patient.whatsapp_opt_in ? (
              <Alert severity="warning">
                {name} has not opted in to WhatsApp, so the message cannot be sent. Turn on WhatsApp reminders for this patient first.
              </Alert>
            ) : null
          ) : (
            <Alert severity="info">
              The Business app is not connected, so this opens WhatsApp with the message ready to send.
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary">
            To {name} · {patient.phone || "no phone number"}
          </Typography>
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={3}
            label="Message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            helperText={`${message.length}/${MAX_LENGTH} characters.${isApi ? " The message is sent inside the clinic's approved manual template." : " The message is typed into the WhatsApp chat for you to send."}`}
            inputProps={{ maxLength: MAX_LENGTH }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => void send()}
          disabled={busy || !patient.phone || (isApi && (!message.trim() || !patient.whatsapp_opt_in))}
          startIcon={isApi ? <IconSend size={16} /> : <IconBrandWhatsapp size={16} />}
        >
          {busy ? "Sending..." : isApi ? "Send message" : "Open WhatsApp"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
