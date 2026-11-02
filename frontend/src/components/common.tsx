import { useCallback, useEffect, useRef, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  IconButton,
  MenuItem,
  Pagination,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { IconUpload, IconX } from "@tabler/icons-react";
import { fetchAvatarUrl } from "../api";
import { useLiveRefresh } from "../lib/realtime";

/** Debounces a value so filter inputs don't fire a request per keystroke. */
export function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}

/** Shows a private avatar via an authenticated fetch; falls back to initials. */
export function PersonAvatar({ token, endpoint, name, hasAvatar, size = 34, cacheKey }: {
  token: string; endpoint: string; name: string; hasAvatar?: boolean; size?: number; cacheKey?: string | number;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const image = useRef<string | null>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const version = ++request.current;
    const next = token && hasAvatar ? await fetchAvatarUrl(endpoint, token) : null;
    if (version !== request.current) {
      if (next) URL.revokeObjectURL(next);
      return;
    }
    const previous = image.current;
    image.current = next;
    setSrc(next);
    if (previous) URL.revokeObjectURL(previous);
  }, [endpoint, token, hasAvatar, cacheKey]);
  useLiveRefresh(load, !!token);
  useEffect(() => {
    setSrc(null);
    void load();
    return () => {
      request.current += 1;
      if (image.current) URL.revokeObjectURL(image.current);
      image.current = null;
    };
  }, [load]);
  return (
    <Avatar src={src ?? undefined} alt={name} sx={{ width: size, height: size, fontSize: size * 0.36, bgcolor: "#dff3ee", color: "#0b6b68", fontWeight: 700 }}>
      {initials(name)}
    </Avatar>
  );
}

/** Choose / preview / remove an image for upload. Validates type and size client-side (server re-validates). */
export function AvatarPicker({ file, onChange, currentSrcLabel, currentSrc, disabled }: {
  file: File | null; onChange: (f: File | null) => void; currentSrcLabel?: string; currentSrc?: string | null; disabled?: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const pick = (f: File | undefined) => {
    setError("");
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) { setError("Use a JPG, PNG or WebP image."); return; }
    if (f.size > 2 * 1024 * 1024) { setError("Image must be 2 MB or smaller."); return; }
    onChange(f);
  };
  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <Avatar src={preview ?? currentSrc ?? undefined} sx={{ width: 64, height: 64, bgcolor: "#dff3ee", color: "#0b6b68" }}>{currentSrcLabel ?? "?"}</Avatar>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1}>
          <Button component="label" size="small" variant="outlined" startIcon={<IconUpload size={16} />} disabled={disabled}>
            {file ? "Change photo" : "Upload photo"}
            <input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => pick(e.target.files?.[0])} />
          </Button>
          {file && <IconButton aria-label="Clear selected photo" size="small" onClick={() => onChange(null)}><IconX size={16} /></IconButton>}
        </Stack>
        <Typography variant="caption" color="text.secondary">JPG, PNG or WebP, up to 2 MB</Typography>
        {error && <Typography variant="caption" color="error">{error}</Typography>}
      </Stack>
    </Stack>
  );
}

/** Pagination footer bound to a server-side paginator response. */
export function PagerBar({ page, lastPage, total, perPage, onPage, onPerPage }: {
  page: number; lastPage: number; total: number; perPage: number;
  onPage: (p: number) => void; onPerPage: (n: number) => void;
}) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between" sx={{ mt: 2, minWidth: 0, width: "100%" }}>
      <Typography variant="body2" color="text.secondary">{total} result{total === 1 ? "" : "s"}</Typography>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", justifyContent: { xs: "space-between", sm: "flex-end" }, gap: 1 }}>
        <TextField select size="small" label="Rows" value={perPage} onChange={(e) => onPerPage(Number(e.target.value))} sx={{ width: { xs: 80, sm: 96 } }}>
          {[10, 20, 50, 100].map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
        </TextField>
        <Pagination page={page} count={Math.max(1, lastPage)} onChange={(_, p) => onPage(p)} color="primary" shape="rounded" size="small" siblingCount={0} boundaryCount={1} />
      </Stack>
    </Stack>
  );
}

/** Keeps a search input in sync with the server filter after debounce. */
export function SearchField({ value, onChange, placeholder, sx }: {
  value: string; onChange: (v: string) => void; placeholder: string; sx?: object;
}) {
  return (
    <TextField
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      sx={{
        width: { xs: "100%", sm: "auto" },
        minWidth: { xs: 0, sm: 220 },
        maxWidth: { xs: "100%", md: 380 },
        flex: { xs: "1 1 100%", sm: "1 1 auto" },
        "& .MuiInputBase-input": {
          textOverflow: "ellipsis",
        },
        ...sx,
      }}
    />
  );
}

/** Generic status select used by filter bars. */
export function FilterSelect({ label, value, onChange, options, width = 170, sx }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; width?: number | string; sx?: object;
}) {
  return (
    <TextField
      select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      sx={{
        width: { xs: "100%", sm: width },
        flex: { xs: "1 1 calc(50% - 6px)", sm: "none" },
        minWidth: { xs: 0, sm: 130 },
        ...sx,
      }}
    >
      <MenuItem value="">All</MenuItem>
      {options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
    </TextField>
  );
}

export function Box2({ children }: { children: React.ReactNode }) {
  return <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>{children}</Box>;
}
