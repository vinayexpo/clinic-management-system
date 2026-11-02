import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { IconCheck } from "@tabler/icons-react";
import { authApi, fetchAvatarUrl, type ApiUser } from "../api";
import { AvatarPicker, initials } from "./common";
import { useLiveRefresh } from "../lib/realtime";

/**
 * Staff profile editing for the signed-in user: display name, phone and photo.
 * Role, activation and the doctor record stay under admin control.
 */
export function MyProfileDialog({ token, user, onClose, onSaved, toast }: {
  token: string;
  user: ApiUser;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  toast: (message: string) => void;
}) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [currentPhoto, setCurrentPhoto] = useState<string | null>(null);
  const [savedUser, setSavedUser] = useState(user);
  const [photoVersion, setPhotoVersion] = useState(0);
  const [stale, setStale] = useState(false);
  const baseline = useRef(JSON.stringify([user.name, user.phone ?? ""]));
  const editor = useRef({ name, phone, file, removePhoto, busy });
  editor.current = { name, phone, file, removePhoto, busy };
  useLiveRefresh(async () => {
    const res = await authApi.me(token);
    const next = res.data;
    const local = editor.current;
    const dirty = local.file || local.removePhoto || local.busy || JSON.stringify([local.name, local.phone]) !== baseline.current;
    if (dirty) {
      setStale(JSON.stringify([next.name, next.phone ?? ""]) !== baseline.current || !!local.file || local.removePhoto);
    } else {
      baseline.current = JSON.stringify([next.name, next.phone ?? ""]);
      setName(next.name);
      setPhone(next.phone ?? "");
      setStale(false);
    }
    setSavedUser(next);
    setPhotoVersion((version) => version + 1);
  }, !!token);

  useEffect(() => {
    setCurrentPhoto(null);
    if (!savedUser.has_avatar) return;
    let url: string | null = null;
    let alive = true;
    fetchAvatarUrl(`/users/${user.id}/avatar`, token).then((next) => {
      url = next;
      if (alive) setCurrentPhoto(next);
      else if (next) URL.revokeObjectURL(next);
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [token, user.id, savedUser.has_avatar, photoVersion]);

  const save = async () => {
    if (changingPassword) {
      if (!currentPassword) {
        setError("Please enter your current password.");
        return;
      }
      if (newPassword.length < 8) {
        setError("New password must be at least 8 characters.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("New passwords do not match.");
        return;
      }
    }
    setBusy(true); setError("");
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        phone: phone.trim(),
        remove_avatar: removePhoto && !file,
      };
      if (changingPassword && newPassword) {
        payload.current_password = currentPassword;
        payload.password = newPassword;
      }
      await authApi.updateMe(token, payload, file);
      await onSaved();
      toast("Profile updated");
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save your profile.");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>My profile</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {stale && <Alert severity="warning" sx={{ mb: 2 }}>Your profile may have changed elsewhere. Your edits and selected photo are kept. Close and reopen to review the saved profile.</Alert>}
        <Stack spacing={2.5}>
          <Box>
            <AvatarPicker
              file={file}
              onChange={(next) => { setFile(next); if (next) setRemovePhoto(false); }}
              currentSrcLabel={initials(user.name)}
              currentSrc={currentPhoto}
              disabled={busy}
            />
            {savedUser.has_avatar && !file && (
              <Button size="small" color="warning" sx={{ mt: 1 }} onClick={() => setRemovePhoto((value) => !value)}>
                {removePhoto ? "Keep current photo" : "Remove current photo"}
              </Button>
            )}
          </Box>
          <TextField fullWidth size="small" label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField fullWidth size="small" label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)}
            helperText="Used for clinic calls and WhatsApp." />

          <Box sx={{ pt: 1, borderTop: "1px solid #e7eeeb" }}>
            <Button
              size="small"
              variant="text"
              onClick={() => {
                setChangingPassword(!changingPassword);
                setCurrentPassword("");
                setNewPassword("");
                setConfirmPassword("");
                setError("");
              }}
              sx={{ fontWeight: 600, mb: changingPassword ? 1.5 : 0 }}
            >
              {changingPassword ? "Cancel password change" : "Change password"}
            </Button>
            {changingPassword && (
              <Stack spacing={1.5}>
                <TextField
                  fullWidth
                  size="small"
                  type="password"
                  label="Current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <TextField
                  fullWidth
                  size="small"
                  type="password"
                  label="New password (min 8 characters)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <TextField
                  fullWidth
                  size="small"
                  type="password"
                  label="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  error={confirmPassword.length > 0 && newPassword !== confirmPassword}
                  helperText={confirmPassword.length > 0 && newPassword !== confirmPassword ? "Passwords do not match" : ""}
                />
              </Stack>
            )}
          </Box>

          <Typography variant="caption" color="text.secondary">
            Your role, account status and doctor details are managed by the clinic administrator.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy || !name.trim()} startIcon={<IconCheck size={16} />}>
          {busy ? "Saving..." : "Save profile"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
