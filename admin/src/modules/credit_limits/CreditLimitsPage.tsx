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
import { useTranslation } from '@/i18n/useTranslation';
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
  const t = useTranslation('core');
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
      setError(err instanceof ApiError ? err.envelope.error.message : t('creditLimits.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
        setError(err instanceof ApiError ? err.envelope.error.message : t('creditLimits.error.lookup'));
      }
    } finally {
      setSelectedLoading(false);
    }
  }, [t]);

  const handleGrant = useCallback(
    async (input: { grantedAmount: number; currency: string; reason?: string }): Promise<void> => {
      if (!selectedOrgId) return;
      try {
        await apiClient.post<{ data: CreditLimitView }>(
          `/api/v1/admin/organizations/${selectedOrgId}/credit-limit`,
          input,
        );
        setInfo(
          t('creditLimits.success.grant', {
            amount: input.grantedAmount,
            currency: input.currency,
            orgId: selectedOrgId.slice(0, 8),
          }),
        );
        await loadSelected(selectedOrgId);
        await refreshList();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('creditLimits.error.grant'));
      }
    },
    [selectedOrgId, loadSelected, refreshList, t],
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
        setInfo(t('creditLimits.success.adjust', { orgId: selectedOrgId.slice(0, 8) }));
        await loadSelected(selectedOrgId);
        await refreshList();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('creditLimits.error.adjust'));
      }
    },
    [selectedOrgId, loadSelected, refreshList, t],
  );

  return (
    <>
      <PageHeader
        title={t('creditLimits.page.title')}
        description={t('creditLimits.page.description')}
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
            <p className="text-sm text-muted-foreground">{t('creditLimits.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('creditLimits.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('creditLimits.column.organization')}</TableHead>
                  <TableHead>{t('creditLimits.column.granted')}</TableHead>
                  <TableHead>{t('creditLimits.column.available')}</TableHead>
                  <TableHead>{t('creditLimits.column.reservations')}</TableHead>
                  <TableHead>{t('creditLimits.column.grantedAt')}</TableHead>
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
                        {t('creditLimits.action.open')}
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
          <CardTitle>{t('creditLimits.editor.title')}</CardTitle>
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
              <Label>{t('creditLimits.field.orgId')}</Label>
              <Input
                value={orgIdInput}
                onChange={(e): void => setOrgIdInput(e.target.value)}
                placeholder={t('creditLimits.placeholder.uuid')}
                required
              />
            </div>
            <Button type="submit" variant="outline">
              {t('creditLimits.action.lookup')}
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
  const t = useTranslation('core');
  const [grantedAmount, setGrantedAmount] = useState(String(limit.grantedAmount));
  const [reason, setReason] = useState('');
  const [allowOverAllocation, setAllowOverAllocation] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('creditLimits.adjust.title', {
            orgId: limit.organizationId.slice(0, 8),
            currency: limit.currency,
          })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('creditLimits.adjust.summary', {
            granted: limit.grantedAmount.toFixed(2),
            available: limit.availableAmount.toFixed(2),
            reserved: (limit.grantedAmount - limit.availableAmount).toFixed(2),
            count: limit.activeReservations.length,
          })}
        </p>
        {limit.activeReservations.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('creditLimits.column.order')}</TableHead>
                <TableHead>{t('creditLimits.column.reserved')}</TableHead>
                <TableHead>{t('creditLimits.column.since')}</TableHead>
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
            <Label>{t('creditLimits.field.newGranted', { currency: limit.currency })}</Label>
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
            <Label>{t('creditLimits.field.reasonAudit')}</Label>
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
            {t('creditLimits.field.allowOverAllocation')}
          </label>
          <div>
            <Button type="submit">{t('creditLimits.action.saveAdjust')}</Button>
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
  const t = useTranslation('core');
  const [grantedAmount, setGrantedAmount] = useState('5000');
  const [currency, setCurrency] = useState('PLN');
  const [reason, setReason] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('creditLimits.grant.title', { orgId: orgId.slice(0, 8) })}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          {t('creditLimits.grant.notGrantedYet')}
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
              <Label>{t('creditLimits.field.grantedAmount')}</Label>
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
              <Label>{t('creditLimits.field.currency')}</Label>
              <CurrencyPicker
                value={currency}
                onChange={(e): void => setCurrency(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('creditLimits.field.reasonOptional')}</Label>
            <Input
              value={reason}
              onChange={(e): void => setReason(e.target.value)}
              maxLength={2000}
            />
          </div>
          <Button type="submit">{t('creditLimits.action.grant')}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
