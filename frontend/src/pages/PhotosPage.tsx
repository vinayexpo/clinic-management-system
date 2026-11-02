import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { IconPhoto, IconSearch, IconTrash, IconUpload } from "@tabler/icons-react";
import { fetchAvatarUrl, patientApi, photoApi, userApi, type PhotoRow, type UserRole } from "../api";
import { PagerBar, PersonAvatar, SearchField, initials } from "../components/common";
import { useLiveRefresh } from "../lib/realtime";

const TYPES = [
  { value: "all", label: "Everyone" },
  { value: "staff", label: "Staff" },
  { value: "patients", label: "Patients" },
];

const ROLE_LABELS: Record<string, string> = {
  doctor: "doctor",
  receptionist: "reception",
};

function avatarEndpoint(row: PhotoRow): string {
  return row.type === "staff" ? `/users/${row.id}/avatar` : `/patients/${row.id}/avatar`;
}

/**
 * Photo manager: find any staff or patient photo, view it, replace it, or remove it.
 * Administrators manage every photo; other staff manage only their own role.
 */
export function PhotosPage({ token, role, toast }: { token: string; role: UserRole; toast: (message: string) => void }) {
  const isAdmin = role === "admin";
  const [rows, setRows] = useState<PhotoRow[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<PhotoRow | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async (targetPage: number) => {
    const id = ++request.current;
    setLoading(true); setError("");
    try {
      const res = await photoApi.list(token, {
        page: targetPage,
        type: isAdmin ? type : "staff",
        search: search.trim() || undefined,
        has_photo: onlyMissing ? "0" : undefined,
        per_page: perPage,
      });
      if (id !== request.current) return;
      const data = (res as unknown as { data: { data: PhotoRow[]; last_page: number; total: number } }).data;
      setRows(data.data);
      setLastPage(data.last_page);
      setTotal(data.total);
      setViewing((current) => current ? data.data.find((row) => row.type === current.type && row.id === current.id) ?? current : null);
    } catch (e: unknown) {
      if (id === request.current) setError(e instanceof Error ? e.message : "Could not load photos.");
    } finally { if (id === request.current) setLoading(false); }
  }, [token, type, search, onlyMissing, perPage, isAdmin]);

  useEffect(() => { void load(page); return () => { ++request.current; }; }, [load, page]);
  useEffect(() => { setPage(1); }, [type, search, onlyMissing, perPage]);
  useLiveRefresh(async () => {
    await load(page);
    if (!viewing) return;
    try {
      const { data } = viewing.type === "staff" ? await userApi.get(token, viewing.id) : await patientApi.get(token, viewing.id);
      setViewing((current) => current?.id === viewing.id && current.type === viewing.type
        ? { ...current, has_photo: data.has_avatar, name: "name" in data ? data.name : [data.first_name, data.last_name].filter(Boolean).join(" ") }
        : current);
    } catch {
      setError("Could not refresh the open photo.");
      setViewing((current) => current?.id === viewing.id && current.type === viewing.type ? { ...current, has_photo: false } : current);
    }
  });

  useEffect(() => {
    setViewUrl(null);
    if (!viewing?.has_photo) { setViewUrl(null); return; }
    let url: string | null = null;
    let alive = true;
    fetchAvatarUrl(avatarEndpoint(viewing), token).then((next) => {
      url = next;
      if (alive) setViewUrl(next);
      else if (next) URL.revokeObjectURL(next);
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [viewing, token]);

  const replace = async (row: PhotoRow, file: File) => {
    setBusyId(`${row.type}-${row.id}`); setError("");
    try {
      await photoApi.replace(token, row.type, row.id, file);
      toast("Photo replaced");
      await load(page);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not replace the photo.");
    } finally { setBusyId(null); }
  };

  const remove = async (row: PhotoRow) => {
    setBusyId(`${row.type}-${row.id}`); setError("");
    try {
      await photoApi.remove(token, row.type, row.id);
      toast("Photo removed");
      await load(page);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not remove the photo.");
    } finally { setBusyId(null); }
  };

  return (
    <Card><CardContent>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }} sx={{ mb: 2 }}>
        <SearchField value={search} onChange={setSearch} placeholder="Search name or ID" />
        {isAdmin ? (
          <Stack direction="row" spacing={1} alignItems="center">
            {TYPES.map((option) => <Chip
              key={option.value}
              label={option.label}
              onClick={() => setType(option.value)}
              color={type === option.value ? "primary" : "default"}
              variant={type === option.value ? "filled" : "outlined"}
              sx={{ cursor: "pointer" }}
            />)}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            You can manage photos for {ROLE_LABELS[role] ?? role} accounts.
          </Typography>
        )}
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ ml: { md: "auto" } }}>
          <FormControlLabel
            control={<Switch checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} size="small" />}
            label={<Typography variant="body2" color="text.secondary">Only without a photo</Typography>}
          />
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading && rows.length === 0 && <Box sx={{ display: "grid", placeItems: "center", py: 4 }}><CircularProgress /></Box>}

      {!loading && rows.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 3 }}>
          <IconPhoto size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
          No people match this filter.
        </Typography>
      )}

      {rows.length > 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 1.5 }}>
          {rows.map((row) => {
            const key = `${row.type}-${row.id}`;
            const busy = busyId === key;
            return (
              <Box key={key} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5 }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <PersonAvatar
                    token={token}
                    endpoint={avatarEndpoint(row)}
                    name={row.name || row.detail}
                    hasAvatar={row.has_photo}
                    size={48}
                    cacheKey={row.updated_at ?? undefined}
                  />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" fontWeight={700} noWrap>{row.name}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {row.type === "staff" ? "Staff" : "Patient"} · {row.detail}
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                  <Button component="label" size="small" variant="outlined" startIcon={<IconUpload size={15} />} disabled={busy}>
                    {row.has_photo ? "Replace" : "Upload"}
                    <input
                      hidden
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void replace(row, file);
                      }}
                    />
                  </Button>
                  {row.has_photo && (
                    <IconButton
                      aria-label={`View photo of ${row.name}`}
                      size="small"
                      onClick={() => setViewing(row)}
                    >
                      <IconSearch size={16} />
                    </IconButton>
                  )}
                  <IconButton
                    aria-label={`Remove photo of ${row.name}`}
                    size="small"
                    color="error"
                    disabled={busy || !row.has_photo}
                    onClick={() => void remove(row)}
                  >
                    <IconTrash size={16} />
                  </IconButton>
                </Stack>
              </Box>
            );
          })}
        </Box>
      )}

      {total > 0 && (
        <PagerBar page={page} lastPage={lastPage} total={total} perPage={perPage}
          onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />
      )}

      <Dialog open={!!viewing} onClose={() => setViewing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{viewing?.name}</DialogTitle>
        <DialogContent>
          {viewUrl ? (
            <Box component="img" src={viewUrl} alt={`Profile photo of ${viewing?.name ?? ""}`}
              sx={{ width: "100%", borderRadius: 2, display: "block" }} />
          ) : (
            <Box sx={{ display: "grid", placeItems: "center", py: 4 }}>
              <Typography color="text.secondary">{viewing?.name?.slice(0, 1).toUpperCase() ?? initials(viewing?.name ?? "")}</Typography>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </CardContent></Card>
  );
}
