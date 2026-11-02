import { useEffect, useState } from "react";
import { Alert, Box, Button, Card, CardContent, CircularProgress, TextField, Typography } from "@mui/material";
import { IconStethoscope } from "@tabler/icons-react";
import { PASSWORD_MIN, fetchClinicLogo, setupApi } from "../api";
import { useAuth } from "../AuthContext";

/** The clinic's own name and logo, shown before anyone signs in. */
function useClinicBrand() {
  const [name, setName] = useState("Carehaven");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let alive = true;

    setupApi.status()
      .then((r) => {
        const data = (r as unknown as { data: { clinic_name?: string | null } }).data;
        if (alive && data.clinic_name) setName(data.clinic_name);
      })
      .catch(() => {});

    void fetchClinicLogo().then((url) => {
      objectUrl = url;
      if (alive) setLogoUrl(url);
    });

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  return { name, logoUrl };
}

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const brand = useClinicBrand();
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2, bgcolor: "#f5f7f4" }}>
      <Card sx={{ maxWidth: 440, width: "100%" }}>
        <CardContent sx={{ p: 3 }}>
          <Box className="brand" sx={{ px: 0, pb: 2 }}>
            {brand.logoUrl
              ? <Box className="brand-mark brand-mark-logo" aria-hidden="true"><img src={brand.logoUrl} alt="" /></Box>
              : <Box className="brand-mark" aria-hidden="true"><IconStethoscope size={21} /></Box>}
            <Box><Typography className="brand-name">{brand.name}</Typography><Typography className="brand-sub">Clinic management</Typography></Box>
          </Box>
          <Typography variant="h4" sx={{ fontFamily: "Georgia, serif" }}>{title}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>{subtitle}</Typography>
          {children}
        </CardContent>
      </Card>
    </Box>
  );
}

/** Decides between first-run admin signup and normal sign-in, based on the server's setup status. */
export function AuthGate() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState("");
  const load = () => {
    setLoadError("");
    setupApi.status()
      .then((r) => setNeedsSetup((r as unknown as { data: { needs_setup: boolean } }).data.needs_setup))
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "Cannot reach the server."));
  };
  useEffect(load, []);

  if (needsSetup === null && !loadError) {
    return <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><CircularProgress /></Box>;
  }
  if (loadError) {
    return (
      <Shell title="Server unavailable" subtitle="The clinic API could not be reached.">
        <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>
        <Button variant="contained" fullWidth onClick={load}>Try again</Button>
      </Shell>
    );
  }
  return needsSetup ? <AdminSignup onDone={() => setNeedsSetup(false)} /> : <SignIn />;
}

function AdminSignup({ onDone }: { onDone: () => void }) {
  const auth = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;
  const short = password.length > 0 && password.length < PASSWORD_MIN;
  const canSubmit = name && email && password.length >= PASSWORD_MIN && password === confirm && !busy;

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const res = await setupApi.createAdmin({ name, email, phone: phone || undefined, password, password_confirmation: confirm });
      const payload = (res as unknown as { data: { user: import("../api").ApiUser; token: string } }).data;
      auth.adoptSession(payload.user, payload.token);
      onDone();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Setup failed.");
    } finally { setBusy(false); }
  };

  return (
    <Shell title="Create administrator" subtitle="No administrator exists yet. Create the first account to set up this clinic. This form closes after setup.">
      {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
      <TextField fullWidth label="Full name *" value={name} onChange={(e) => setName(e.target.value)} sx={{ mb: 2 }} autoFocus />
      <TextField fullWidth label="Email *" type="email" value={email} onChange={(e) => setEmail(e.target.value)} sx={{ mb: 2 }} autoComplete="email" />
      <TextField fullWidth label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} sx={{ mb: 2 }} />
      <TextField fullWidth label={`Password * (min ${PASSWORD_MIN} characters)`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={short} helperText={short ? `At least ${PASSWORD_MIN} characters` : " "} sx={{ mb: 1 }} autoComplete="new-password" />
      <TextField fullWidth label="Confirm password *" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch} helperText={mismatch ? "Passwords do not match" : " "} autoComplete="new-password" />
      <Button fullWidth variant="contained" size="large" sx={{ mt: 1 }} disabled={!canSubmit} onClick={() => void submit()}>
        {busy ? <CircularProgress size={20} /> : "Create administrator & sign in"}
      </Button>
    </Shell>
  );
}

function SignIn() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localErr, setLocalErr] = useState("");
  const submit = async () => {
    setLocalErr("");
    const identifier = email.trim();
    if (!identifier || !password) { setLocalErr("Enter your email or phone number and password."); return; }
    try { await auth.login(identifier, password); } catch (e: unknown) { setLocalErr(e instanceof Error ? e.message : "Sign-in failed."); }
  };
  return (
    <Shell title="Welcome back" subtitle="Staff: sign in with your email. Patients: sign in with your registered phone number.">
      {(localErr || auth.error) && <Alert severity="error" sx={{ mb: 2 }}>{localErr || auth.error}</Alert>}
      <TextField fullWidth label="Email or phone number" value={email} onChange={(e) => setEmail(e.target.value)} sx={{ mb: 2 }} autoComplete="username" inputProps={{ inputMode: "text" }} helperText="Staff use email. Patients use their registered phone." />
      <TextField fullWidth label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} autoComplete="current-password" />
      <Button fullWidth variant="contained" size="large" sx={{ mt: 3 }} disabled={auth.isLoading} onClick={() => void submit()}>
        {auth.isLoading ? <CircularProgress size={20} /> : "Sign in"}
      </Button>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
        Staff accounts and patient portal logins are created by the clinic administrator. Contact the front desk if you cannot sign in.
      </Typography>
    </Shell>
  );
}
