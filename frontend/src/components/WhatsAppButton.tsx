import { Button, IconButton, Tooltip } from "@mui/material";
import { IconBrandWhatsapp } from "@tabler/icons-react";
import { getClinicDetails } from "../lib/clinicStore";
import { whatsappChatLink } from "../lib/whatsapp";

/**
 * Opens WhatsApp with the given number and message.
 *
 * It is a real link, so it opens in a new tab without a popup prompt and works
 * with the keyboard. When the record has no usable number, the control stays
 * visible but disabled and says why.
 */
export function WhatsAppButton({ phone, message, label, tooltip, reason, variant = "button", size = "small", patientName }: {
  phone: string | null | undefined;
  message?: string;
  label?: string;
  tooltip?: string;
  reason?: string;
  variant?: "button" | "icon";
  size?: "small" | "medium";
  patientName?: string;
}) {
  const { countryCode } = getClinicDetails();
  const link = whatsappChatLink(phone, message ?? "", countryCode);
  const description = tooltip ?? (patientName ? `Send WhatsApp message to ${patientName}` : "Send WhatsApp message");

  if (!link) {
    return (
      <Tooltip title={reason ?? "No phone number on file"}>
        <span>
          {variant === "icon"
            ? <IconButton size={size} disabled aria-label={`WhatsApp unavailable: ${reason ?? "no phone number on file"}`}><IconBrandWhatsapp size={16} /></IconButton>
            : <Button size={size} variant="outlined" disabled startIcon={<IconBrandWhatsapp size={16} />}>{label ?? "WhatsApp"}</Button>}
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={description}>
      {variant === "icon" ? (
        <IconButton
          component="a"
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          size={size}
          aria-label={description}
          sx={{ color: "#128c7e" }}
        >
          <IconBrandWhatsapp size={16} />
        </IconButton>
      ) : (
        <Button
          component="a"
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          size={size}
          variant="outlined"
          startIcon={<IconBrandWhatsapp size={16} />}
          aria-label={description}
        >
          {label ?? "WhatsApp"}
        </Button>
      )}
    </Tooltip>
  );
}
