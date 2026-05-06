import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CurrencyPicker } from '../dictionaries/components/CurrencyPicker';

interface ActiveReservation {
  orderId: string;
  amount: number;
  createdAt: string;
}

interface CreditLimitView {
  organizationId: string;
  grantedAmount: number;
  availableAmount: number;
  currency: string;
  activeReservations: ActiveReservation[];
  grantedAt: string;
}

export function CreditLimitsPage(): ReactNode {
  const [rows, setRows] = useState<CreditLimitView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [orgIdInput, setOrgIdInput] = useState('');
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selected, setSelected] = useState<CreditLimitView | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  const refreshList = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: CreditLimitView[] }>('/api/v1/admin/credit-limits');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const loadSelected = useCallback(async (orgId: string): Promise<void> => {
    setSelectedLoading(true);
    setSelected(null);
    setSelectedOrgId(orgId);
    try {
      const res = await apiClient.get<{ data: CreditLimitView }>(
        `/api/v1/admin/organizations/${orgId}/credit-limit`,
      );
      setSelected(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'CREDIT_LIMIT_NOT_GRANTED') {
        setSelected(null);
      } else {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Lookup failed.');
      }
    } finally {
      setSelectedLoading(false);
    }
  }, []);

  const handleGrant = useCallback(
    async (input: { grantedAmount: number; currency: string; reason?: string }): Promise<void> => {
      if (!selectedOrgId) return;
      try {
        await apiClient.post<{ data: CreditLimitView }>(
          `/api/v1/admin/organizations/${selectedOrgId}/credit-limit`,
          input,
        );
        setInfo(`Granted ${input.grantedAmount} ${input.currency} to ${selectedOrgId.slice(0, 8)}.`);
        await loadSelected(selectedOrgId);
        await refreshList();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Grant failed.');
      }
    },
    [selectedOrgId, loadSelected, refreshList],
  );

  const handleAdjust = useCallback(
    async (input: {
      grantedAmount: number;
      reason?: string;
      allowOverAllocation: boolean;
    }): Promise<void> => {
      if (!selectedOrgId) return;
      try {
        await apiClient.patch<{ data: CreditLimitView }>(
          `/api/v1/admin/organizations/${selectedOrgId}/credit-limit`,
          input,
        );
        setInfo(`Adjusted credit limit for ${selectedOrgId.slice(0, 8)}.`);
        await loadSelected(selectedOrgId);
        await refreshList();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Adjust failed.');
      }
    },
    [selectedOrgId, loadSelected, refreshList],
  );

  return (
    <>
      <PageHeader
        title="Credit limits"
        description="Grant and adjust deferred-payment limits per organization. Adjustments below the active-reservations sum are rejected unless explicitly overridden."
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No credit limits granted yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Granted</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Reservations</TableHead>
                  <TableHead>Granted at</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.organizationId}>
                    <TableCell>
                      <code className="font-mono text-xs">{r.organizationId.slice(0, 8)}</code>
                    </TableCell>
                    <TableCell>
                      {r.grantedAmount.toFixed(2)} {r.currency}
                    </TableCell>
                    <TableCell>
                      {r.availableAmount.toFixed(2)} {r.currency}
                    </TableCell>
                    <TableCell>{r.activeReservations.length}</TableCell>
                    <TableCell>{formatDateTime(r.grantedAt)}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(): void => {
                          setOrgIdInput(r.organizationId);
                          void loadSelected(r.organizationId);
                        }}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Per-organization editor</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e: FormEvent): void => {
              e.preventDefault();
              void loadSelected(orgIdInput.trim());
            }}
          >
            <div className="flex-1 space-y-2">
              <Label>Organization id</Label>
              <Input
                value={orgIdInput}
                onChange={(e): void => setOrgIdInput(e.target.value)}
                placeholder="UUID"
                required
              />
            </div>
            <Button type="submit" variant="outline">
              Look up
            </Button>
          </form>
        </CardContent>
      </Card>

      {selectedOrgId && !selectedLoading ? (
        selected ? (
          <ExistingLimitPanel limit={selected} onAdjust={handleAdjust} />
        ) : (
          <GrantPanel orgId={selectedOrgId} onGrant={handleGrant} />
        )
      ) : null}
    </>
  );
}

function ExistingLimitPanel({
  limit,
  onAdjust,
}: {
  limit: CreditLimitView;
  onAdjust: (input: {
    grantedAmount: number;
    reason?: string;
    allowOverAllocation: boolean;
  }) => Promise<void>;
}): ReactNode {
  const [grantedAmount, setGrantedAmount] = useState(String(limit.grantedAmount));
  const [reason, setReason] = useState('');
  const [allowOverAllocation, setAllowOverAllocation] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Adjust {limit.organizationId.slice(0, 8)} ({limit.currency})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Granted {limit.grantedAmount.toFixed(2)} · Available {limit.availableAmount.toFixed(2)} ·
          Reserved {(limit.grantedAmount - limit.availableAmount).toFixed(2)} across{' '}
          {limit.activeReservations.length} order(s).
        </p>
        {limit.activeReservations.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Reserved</TableHead>
                <TableHead>Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {limit.activeReservations.map((r) => (
                <TableRow key={r.orderId}>
                  <TableCell>
                    <code className="font-mono text-xs">{r.orderId.slice(0, 8)}</code>
                  </TableCell>
                  <TableCell>
                    {r.amount.toFixed(2)} {limit.currency}
                  </TableCell>
                  <TableCell>{formatDateTime(r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent): void => {
            e.preventDefault();
            void onAdjust({
              grantedAmount: Number(grantedAmount),
              ...(reason ? { reason } : {}),
              allowOverAllocation,
            });
          }}
        >
          <div className="space-y-2">
            <Label>New granted amount ({limit.currency})</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={grantedAmount}
              onChange={(e): void => setGrantedAmount(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Reason (optional, kept on the audit log)</Label>
            <Input
              value={reason}
              onChange={(e): void => setReason(e.target.value)}
              maxLength={2000}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <Checkbox
              checked={allowOverAllocation}
              onChange={(e): void => setAllowOverAllocation(e.target.checked)}
            />
            Allow reduction below active reservations (override)
          </label>
          <div>
            <Button type="submit">Save adjustment</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function GrantPanel({
  orgId,
  onGrant,
}: {
  orgId: string;
  onGrant: (input: { grantedAmount: number; currency: string; reason?: string }) => Promise<void>;
}): ReactNode {
  const [grantedAmount, setGrantedAmount] = useState('5000');
  const [currency, setCurrency] = useState('PLN');
  const [reason, setReason] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Grant credit limit to {orgId.slice(0, 8)}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          No credit limit is granted for this organization yet.
        </p>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent): void => {
            e.preventDefault();
            void onGrant({
              grantedAmount: Number(grantedAmount),
              currency,
              ...(reason ? { reason } : {}),
            });
          }}
        >
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="space-y-2">
              <Label>Granted amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={grantedAmount}
                onChange={(e): void => setGrantedAmount(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <CurrencyPicker
                value={currency}
                onChange={(e): void => setCurrency(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Reason (optional)</Label>
            <Input
              value={reason}
              onChange={(e): void => setReason(e.target.value)}
              maxLength={2000}
            />
          </div>
          <Button type="submit">Grant</Button>
        </form>
      </CardContent>
    </Card>
  );
}
