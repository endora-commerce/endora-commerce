import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { useTranslation } from '@/i18n/useTranslation';
import { OrdersPanel, QuoteRequestsPanel, CartsPanel } from './panels/HistoryPanels';
import {
  OrganizationAssignmentPanel,
  CustomerGroupPanel,
  AddressesPanel,
} from './panels/ManagementPanels';
import { DefaultPreferencesPanel } from '../quick_order/DefaultPreferencesPanel';
import { CustomFieldValuesPanel } from '../custom_fields/CustomFieldValuesPanel';

interface AdminCustomerDetail {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string | null;
  organizationName: string | null;
  customerGroupId: string | null;
  customerGroupName: string | null;
  blocked: boolean;
  deleted: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  block: { blockedAt: string; blockReason: string | null } | null;
  deletion: { deletedAt: string; anonymizedAt: string | null } | null;
  customFieldValues?: Record<string, unknown>;
}

export function CustomerDetail(): ReactNode {
  const { id = '' } = useParams();
  const t = useTranslation('customers');
  const [c, setC] = useState<AdminCustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminCustomerDetail }>(`/api/v1/admin/customers/${id}`);
      setC(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('detail.error'));
    }
  }, [id, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = useCallback(
    async (run: () => Promise<unknown>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await run();
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('detail.actionError'));
      } finally {
        setBusy(false);
      }
    },
    [refresh, t],
  );

  if (!c) {
    return (
      <>
        <PageHeader title={t('detail.title')} />
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">{t('detail.loading')}</p>
        )}
      </>
    );
  }

  const info: Array<[string, ReactNode]> = [
    [t('detail.field.email'), c.email],
    [t('detail.field.created'), formatDateTime(c.createdAt)],
    [t('detail.field.group'), c.customerGroupName ?? t('list.none')],
    [t('detail.field.organization'), c.organizationName ?? t('list.none')],
    [
      t('detail.field.status'),
      c.deleted ? (
        <Badge variant="outline">{t('status.deleted')}</Badge>
      ) : c.blocked ? (
        <Badge variant="destructive">{t('status.blocked')}</Badge>
      ) : (
        <Badge>{t('status.active')}</Badge>
      ),
    ],
    [t('detail.field.lastLogin'), c.lastLoginAt ? formatDateTime(c.lastLoginAt) : t('list.none')],
  ];

  return (
    <>
      <PageHeader title={`${c.firstName} ${c.lastName}`} description={c.email} />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('detail.info.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            {info.map(([label, value]) => (
              <div key={label} className="space-y-1">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('detail.actions.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {c.blocked ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={(): void => void act(() => apiClient.post(`/api/v1/admin/customers/${id}/unblock`, {}))}
            >
              {t('detail.action.unblock')}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={busy || c.deleted}
              onClick={(): void => void act(() => apiClient.post(`/api/v1/admin/customers/${id}/block`, {}))}
            >
              {t('detail.action.block')}
            </Button>
          )}

          <Button
            variant="outline"
            disabled={busy || c.deleted}
            onClick={(): void => void act(() => apiClient.post(`/api/v1/admin/customers/${id}/password-reset`, {}))}
          >
            {t('detail.action.passwordReset')}
          </Button>

          {/* Feature 042 — Platform-Admin 2FA reset (gated by mfa:reset). */}
          <Button
            variant="outline"
            disabled={busy || c.deleted}
            onClick={(): void => void act(() => apiClient.post(`/api/v1/admin/customers/${id}/mfa/reset`, {}))}
          >
            {t('detail.action.resetMfa')}
          </Button>

          <Button
            variant="outline"
            disabled={busy || c.deleted}
            onClick={(): void =>
              void act(async () => {
                const res = await apiClient.post<{ data: { impersonationSessionId: string } }>(
                  `/api/v1/admin/customers/${id}/impersonate`,
                  {},
                );
                return res;
              })
            }
          >
            {t('detail.action.impersonate')}
          </Button>

          {c.deleted ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={(): void => void act(() => apiClient.post(`/api/v1/admin/customers/${id}/restore`, {}))}
            >
              {t('detail.action.restore')}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={(): void => void act(() => apiClient.delete(`/api/v1/admin/customers/${id}`))}
            >
              {t('detail.action.delete')}
            </Button>
          )}
        </CardContent>
      </Card>

      <OrganizationAssignmentPanel customerId={id} organizationId={c.organizationId} onChanged={(): void => void refresh()} />
      <CustomerGroupPanel customerId={id} customerGroupId={c.customerGroupId} onChanged={(): void => void refresh()} />
      <AddressesPanel customerId={id} onChanged={(): void => void refresh()} />
      <DefaultPreferencesPanel scope="customer" scopeId={id} />

      {/* Feature 055 — operator-defined custom fields for this customer. */}
      <CustomFieldValuesPanel
        entityType="customer"
        values={c.customFieldValues ?? {}}
        save={async (values): Promise<void> => {
          await apiClient.patch(`/api/v1/admin/customers/${id}/custom-fields`, values);
          await refresh();
        }}
      />

      <OrdersPanel customerId={id} />
      <QuoteRequestsPanel customerId={id} />
      <CartsPanel customerId={id} />
    </>
  );
}
