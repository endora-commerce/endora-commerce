import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Organization → Sales reps assignment tab (feature 008 / T079).
 *
 * Lists every admin user currently assigned to the organization plus
 * an "Assign" form. Removal is a single delete. Used inline on the
 * Organization detail page; mount with
 *   <OrganizationSalesRepsTab organizationId={org.id} />.
 *
 * The picker is server-side: typing fires a debounced
 * `GET /api/v1/admin/admin-users?q=…` and the Combobox renders the
 * returned page directly. Already-assigned reps are filtered client-side
 * after the response so the option list never re-shows them.
 */

interface SalesRepRow {
  id: string;
  organizationId: string;
  adminUserId: string;
  displayName: string;
  email: string;
  assignedAt: string;
  assignedByAdminUserId: string | null;
}

interface AdminUserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: 'active' | 'inactive';
}

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_PAGE_SIZE = 20;

function adminUserToOption(u: AdminUserRow): ComboboxOption<string> {
  const fullName = `${u.firstName} ${u.lastName}`.trim();
  return {
    value: u.id,
    label: fullName.length > 0 ? fullName : u.email,
    description: fullName.length > 0 ? u.email : undefined,
  };
}

export function OrganizationSalesRepsTab({
  organizationId,
}: {
  organizationId: string;
}): ReactNode {
  const [rows, setRows] = useState<SalesRepRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [selectedAdminUserId, setSelectedAdminUserId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const [pickerOptions, setPickerOptions] = useState<ComboboxOption<string>[]>([]);
  const [pickerSearching, setPickerSearching] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const reps = await apiClient.get<{ data: SalesRepRow[] }>(
        `/api/v1/admin/organizations/${organizationId}/sales-reps`,
      );
      setRows(reps.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const assignedIds = useMemo(() => new Set(rows.map((r) => r.adminUserId)), [rows]);

  // Debounced server-side search. The latest request id wins so out-of-order
  // responses (slow first request, fast second) don't overwrite fresh state.
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);
  useEffect(() => () => {
    if (searchTimerRef.current !== null) clearTimeout(searchTimerRef.current);
  }, []);

  const runSearch = useCallback(
    async (query: string, seq: number): Promise<void> => {
      setPickerSearching(true);
      try {
        const params = new URLSearchParams();
        params.set('page', '0');
        params.set('pageSize', String(SEARCH_PAGE_SIZE));
        if (query.trim().length > 0) params.set('q', query.trim());
        const res = await apiClient.get<{ data: AdminUserRow[] }>(
          `/api/v1/admin/admin-users?${params.toString()}`,
        );
        if (seq !== searchSeqRef.current) return; // stale response
        const filtered = res.data
          .filter((u) => u.status === 'active' && !assignedIds.has(u.id))
          .map(adminUserToOption);
        setPickerOptions(filtered);
      } catch (err) {
        if (seq !== searchSeqRef.current) return;
        setError(err instanceof ApiError ? err.envelope.error.message : 'Search failed.');
        setPickerOptions([]);
      } finally {
        if (seq === searchSeqRef.current) setPickerSearching(false);
      }
    },
    [assignedIds],
  );

  const handleSearchChange = useCallback(
    (query: string): void => {
      if (searchTimerRef.current !== null) clearTimeout(searchTimerRef.current);
      const seq = ++searchSeqRef.current;
      searchTimerRef.current = setTimeout(() => {
        void runSearch(query, seq);
      }, SEARCH_DEBOUNCE_MS);
    },
    [runSearch],
  );

  const handlePickerChange = useCallback(
    (next: string | null): void => {
      setSelectedAdminUserId(next);
      if (next === null) {
        setSelectedLabel('');
        return;
      }
      const opt = pickerOptions.find((o) => o.value === next);
      if (opt) setSelectedLabel(opt.label);
    },
    [pickerOptions],
  );

  const assign = async (): Promise<void> => {
    if (selectedAdminUserId === null) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await apiClient.post(
        `/api/v1/admin/organizations/${organizationId}/sales-reps`,
        { adminUserId: selectedAdminUserId },
      );
      setInfo('Sales rep assigned.');
      setSelectedAdminUserId(null);
      setSelectedLabel('');
      setPickerOptions([]);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Assign failed.');
    } finally {
      setBusy(false);
    }
  };

  const unassign = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await apiClient.delete(
        `/api/v1/admin/organizations/${organizationId}/sales-reps/${id}`,
      );
      setInfo('Sales rep unassigned.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Unassign failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales representatives</CardTitle>
      </CardHeader>
      <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}
        {rows.length === 0 && !loading ? (
          <p style={{ color: 'var(--b2b-muted)', fontSize: 13 }}>
            No sales reps assigned. Quote Requests from this organization are visible to every
            sales rep (unassigned-org fallback).
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Assigned at</TableHead>
                <TableHead style={{ width: 60 }}></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.displayName}</TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell>{new Date(r.assignedAt).toLocaleDateString('pl-PL')}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(): void => void unassign(r.adminUserId)}
                      disabled={busy}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Label htmlFor="rep-picker">Assign new sales rep</Label>
            <Combobox<string>
              id="rep-picker"
              options={pickerOptions}
              value={selectedAdminUserId}
              selectedLabel={selectedLabel}
              onChange={handlePickerChange}
              onSearchChange={handleSearchChange}
              manualFilter
              loading={pickerSearching}
              placeholder="Search by name or email…"
              disabled={busy}
              emptyMessage={pickerSearching ? 'Searching…' : 'No matching admin user.'}
            />
          </div>
          <Button
            onClick={(): void => void assign()}
            disabled={busy || loading || selectedAdminUserId === null}
          >
            <UserPlus size={14} style={{ marginRight: 4 }} /> Assign
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
