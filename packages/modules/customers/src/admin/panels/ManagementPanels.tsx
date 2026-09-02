import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiClient, useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { OrganizationPicker, CustomerGroupPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

interface CommonProps {
  customerId: string;
  onChanged: () => void;
}

function useAction(onChanged: () => void): {
  busy: boolean;
  error: string | null;
  run: (fn: () => Promise<unknown>) => Promise<void>;
} {
  const t = useTranslation('customers');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        onChanged();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('detail.actionError'));
      } finally {
        setBusy(false);
      }
    },
    [onChanged, t],
  );
  return { busy, error, run };
}

export function OrganizationAssignmentPanel({
  customerId,
  organizationId,
  onChanged,
}: CommonProps & { organizationId: string | null }): ReactNode {
  const t = useTranslation('customers');
  const { busy, error, run } = useAction(onChanged);
  const [orgId, setOrgId] = useState<string | null>(null);

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('detail.org.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="assign-org">{t('detail.org.assignLabel')}</Label>
          <div className="flex gap-2">
            <OrganizationPicker id="assign-org" value={orgId} onChange={setOrgId} className="flex-1" />
            <Button
              disabled={busy || !orgId}
              onClick={(): void => {
                if (!orgId) return;
                void run(() => apiClient.post(`/api/v1/admin/customers/${customerId}/organization`, { organizationId: orgId }));
              }}
            >
              {t('detail.org.assign')}
            </Button>
          </div>
        </div>
        {organizationId ? (
          <div className="space-y-1">
            <Button
              variant="outline"
              disabled={busy}
              onClick={(): void => void run(() => apiClient.delete(`/api/v1/admin/customers/${customerId}/organization`))}
            >
              {t('detail.org.unassign')}
            </Button>
            {/*
              D-178 — the operation moves the customer to their own personal
              organization rather than leaving them without one, and the button
              said "Unassign", which described the outcome it used to have.
            */}
            <p className="text-sm text-muted-foreground">{t('detail.org.unassignHint')}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CustomerGroupPanel({
  customerId,
  customerGroupId,
  onChanged,
}: CommonProps & { customerGroupId: string | null }): ReactNode {
  const t = useTranslation('customers');
  const { busy, error, run } = useAction(onChanged);
  const [groupId, setGroupId] = useState<string | null>(null);

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('detail.group.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="set-group">{t('detail.group.setLabel')}</Label>
          <div className="flex gap-2">
            <CustomerGroupPicker id="set-group" value={groupId} onChange={setGroupId} className="flex-1" />
            <Button
              disabled={busy || !groupId}
              onClick={(): void => {
                if (!groupId) return;
                void run(() => apiClient.put(`/api/v1/admin/customers/${customerId}/customer-group`, { customerGroupId: groupId }));
              }}
            >
              {t('detail.group.set')}
            </Button>
          </div>
        </div>
        {customerGroupId ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={(): void =>
              void run(() => apiClient.put(`/api/v1/admin/customers/${customerId}/customer-group`, { customerGroupId: null }))
            }
          >
            {t('detail.group.clear')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface AdminCustomerAddress {
  id: string;
  kind: 'delivery' | 'billing';
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

export function AddressesPanel({ customerId, onChanged }: CommonProps): ReactNode {
  const t = useTranslation('customers');
  const { busy, error, run } = useAction(onChanged);
  const [personal, setPersonal] = useState<AdminCustomerAddress[]>([]);
  const [form, setForm] = useState({
    kind: 'delivery' as 'delivery' | 'billing',
    recipientName: '',
    street: '',
    city: '',
    postalCode: '',
    country: 'PL',
  });

  // Warn before leaving with a partially-filled new-address form.
  useUnsavedChangesPrompt(
    form.recipientName !== '' ||
      form.street !== '' ||
      form.city !== '' ||
      form.postalCode !== '',
  );

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.get<{ data: { personal: AdminCustomerAddress[] } }>(
        `/api/v1/admin/customers/${customerId}/addresses`,
      );
      setPersonal(res.data.personal);
    } catch {
      /* surfaced by useAction on mutations */
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = (): void => {
    void load();
    onChanged();
  };

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('detail.addresses.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {personal.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.addresses.empty')}</p>
        ) : (
          <ul className="divide-y text-sm">
            {personal.map((a) => (
              <li key={a.id} className="py-2">
                <span className="text-muted-foreground">{a.kind}</span> · {a.recipientName} — {a.street},{' '}
                {a.postalCode} {a.city}, {a.country}
                {a.isDefault ? ` (${t('detail.addresses.default')})` : ''}
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={form.kind} onChange={(e): void => setForm({ ...form, kind: e.target.value as 'delivery' | 'billing' })}>
            <option value="delivery">delivery</option>
            <option value="billing">billing</option>
          </Select>
          <Input placeholder={t('detail.addresses.recipient')} value={form.recipientName} onChange={(e): void => setForm({ ...form, recipientName: e.target.value })} />
          <Input placeholder={t('detail.addresses.street')} value={form.street} onChange={(e): void => setForm({ ...form, street: e.target.value })} />
          <Input placeholder={t('detail.addresses.city')} value={form.city} onChange={(e): void => setForm({ ...form, city: e.target.value })} />
          <Input placeholder={t('detail.addresses.postal')} value={form.postalCode} onChange={(e): void => setForm({ ...form, postalCode: e.target.value })} />
          <Input placeholder={t('detail.addresses.country')} value={form.country} maxLength={2} onChange={(e): void => setForm({ ...form, country: e.target.value.toUpperCase() })} />
        </div>
        <Button
          disabled={busy || !form.recipientName || !form.street}
          onClick={(): void =>
            void run(async () => {
              await apiClient.post(`/api/v1/admin/customers/${customerId}/addresses`, form);
              setForm({
                kind: 'delivery',
                recipientName: '',
                street: '',
                city: '',
                postalCode: '',
                country: 'PL',
              });
              reload();
            })
          }
        >
          {t('detail.addresses.add')}
        </Button>
      </CardContent>
    </Card>
  );
}
