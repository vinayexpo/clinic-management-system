import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
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
import { auditApi, type AuditOptions, type AuditRow } from "../api";
import { PagerBar, SearchField } from "./common";
import { istDateTime } from "../lib/ist";
import { useLiveRefresh } from "../lib/realtime";

/**
 * The activity log for administrators: every change recorded in the clinic, with
 * filters and pagination so a long history stays usable.
 */
export function ActivityLogPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [options, setOptions] = useState<AuditOptions>({ actions: [], entity_types: [], users: [] });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [userId, setUserId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    auditApi.options(token)
      .then((res) => setOptions((res as unknown as { data: AuditOptions }).data))
      .catch(() => setOptions({ actions: [], entity_types: [], users: [] }));
  }, [token]);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(""); }
    try {
      const res = await auditApi.list(token, {
        page,
        per_page: perPage,
        search: search.trim() || undefined,
        action: action || undefined,
        entity_type: entityType || undefined,
        user_id: userId ? Number(userId) : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      const data = (res as unknown as { data: { data: AuditRow[]; last_page: number; total: number } }).data;
      setRows(data.data);
      setLastPage(data.last_page);
      setTotal(data.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load the activity log.");
    } finally { if (!silent) setLoading(false); }
  }, [token, page, perPage, search, action, entityType, userId, dateFrom, dateTo]);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(async () => {
    await Promise.all([load(true), auditApi.options(token).then((res) => setOptions(res.data))]);
  }, !!token);
  useEffect(() => { setPage(1); }, [perPage, search, action, entityType, userId, dateFrom, dateTo]);

  const clear = () => {
    setSearch(""); setAction(""); setEntityType(""); setUserId(""); setDateFrom(""); setDateTo("");
  };

  return (
    <Card sx={{ mt: 2 }}>
      <CardContent>
        <Typography component="h2" variant="h6">Activity log</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Every change recorded in the clinic.</Typography>

        <Stack direction={{ xs: "column", md: "row" }} spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          <SearchField value={search} onChange={setSearch} placeholder="Search summary or action" />
          <TextField select size="small" label="Action" value={action} onChange={(e) => setAction(e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="">All actions</MenuItem>
            {options.actions.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Record type" value={entityType} onChange={(e) => setEntityType(e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="">All records</MenuItem>
            {options.entity_types.map((item) => <MenuItem key={item} value={item}>{item.replace(/_/g, " ")}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Staff member" value={userId} onChange={(e) => setUserId(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">Everyone</MenuItem>
            {options.users.map((user) => <MenuItem key={user.id} value={String(user.id)}>{user.name}</MenuItem>)}
          </TextField>
          <TextField size="small" type="date" label="From" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" type="date" label="To" value={dateTo} onChange={(e) => setDateTo(e.target.value)} InputLabelProps={{ shrink: true }} />
          <Button onClick={clear}>Clear filters</Button>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {loading && <Box sx={{ display: "grid", placeItems: "center", py: 3 }}><CircularProgress size={24} /></Box>}

        {!loading && rows.length === 0 && <Typography color="text.secondary" sx={{ py: 2 }}>No activity matches these filters.</Typography>}

        {!loading && rows.length > 0 && <Box className="table-scroll">
          <Table size="small">
            <TableHead><TableRow>
              <TableCell>When</TableCell><TableCell>Staff</TableCell><TableCell>Action</TableCell>
              <TableCell>Record</TableCell><TableCell>Detail</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {rows.map((row) => <TableRow key={row.id}>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{istDateTime(row.created_at)}</TableCell>
                <TableCell>{row.user?.name ?? "System"}</TableCell>
                <TableCell>{row.action}</TableCell>
                <TableCell>{row.entity_type.replace(/_/g, " ")}{row.entity_id ? ` #${row.entity_id}` : ""}</TableCell>
                <TableCell sx={{ maxWidth: 360 }}><Typography variant="body2" sx={{ overflowWrap: "break-word" }}>{row.summary}</Typography></TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </Box>}

        {total > 0 && (
          <PagerBar
            page={page}
            lastPage={lastPage}
            total={total}
            perPage={perPage}
            onPage={setPage}
            onPerPage={(next) => { setPerPage(next); setPage(1); }}
          />
        )}
      </CardContent>
    </Card>
  );
}
