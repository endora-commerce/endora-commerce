import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { useSurfaceVisibility } from '@/lib/surface-visibility';
import {
  deliveryMethodsClient,
  type AdminDeliveryMethod,
  type OrderStatusOption,
} from './api/delivery-methods-client';
import { resolveAdminDeliveryMethodRenderer } from './renderers/registry';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { formatMoney } from '@/lib/money';
import { useTranslation } from '@/i18n/useTranslation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CurrencyPicker } from '@endora-commerce/admin-kit/components';

export function DeliveryMethodsPage(): ReactNode {
  const t = useTranslation('core');
  /**
   * `useSurfaceVisibility` is the predicate the sidebar, the palette and the
   * dashboard already share, and it answers both axes at once: the operator's
   * permission and the owning module's effective presence. The DHL card below
   * was already asking both questions by hand; this is the same question in one
   * expression, which is what stops the two from drifting.
   */
  const isVisible = useSurfaceVisibility();
  const showDhlParcel = isVisible({ module: 'dhl_parcel', requiredPermission: 'dhl_parcel:read' });
  /**
   * The screen's own gate (2026-08-28), on the code its routes now enforce.
   *
   * `delivery_methods` used to borrow `catalog:read`, so this page had no
   * permission of its own to check and the sidebar entry beside it carried the
   * catalogue's. Both moved together; hiding the screen rather than letting it
   * 403 is the treatment the sidebar, the palette and the dashboard already
   * apply to a denied destination, and `AppShell.tsx`'s `PALETTE_ITEMS` comment
   * argues it at length. The module half is asked too, because the admin router
   * carries no guard of its own: a switched-off module must contribute no
   * surface at all (Constitution XVII item 5), and a permission gate alone
   * leaves this screen rendering and answering 503.
   *
   * The fetch is skipped as well as the render — a page that renders nothing has
   * no reason to ask the API two questions it will be refused.
   */
  const canRead = isVisible({
    module: 'delivery_methods',
    requiredPermission: 'delivery_methods:read',
  });
  const showInpost = isVisible({ module: 'inpost', requiredPermission: 'inpost:manage' });
  const [rows, setRows] = useState<AdminDeliveryMethod[]>([]);
  const [orderStatuses, setOrderStatuses] = useState<OrderStatusOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminDeliveryMethod | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [methods, statuses] = await Promise.all([
        deliveryMethodsClient.list(),
        // Shared endpoint owned by the payment-methods admin routes (feature 035);
        // gated `requireAdminAny(['payment_methods:read', 'delivery_methods:read'])`
        // since this module took its own codes, so the read code that opened this
        // screen also opens the status list.
        deliveryMethodsClient.orderStatuses().catch(() => [] as OrderStatusOption[]),
      ]);
      setRows(methods);
      setOrderStatuses(statuses);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [canRead]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUpsert = useCallback(
    async (input: {
      code: string;
      nameEn: string;
      namePl: string;
      cost: number;
      currency: string;
      status: 'active' | 'inactive';
      statusOnSuccess: string;
      statusOnFailure: string;
    }): Promise<void> => {
      const name: Record<string, string> = {};
      if (input.nameEn) name['en-US'] = input.nameEn;
      if (input.namePl) name['pl-PL'] = input.namePl;
      try {
        await deliveryMethodsClient.upsert(input.code, {
          code: input.code,
          name,
          cost: input.cost,
          currency: input.currency,
          status: input.status,
          ...(input.statusOnSuccess ? { statusOnSuccess: input.statusOnSuccess } : {}),
          ...(input.statusOnFailure ? { statusOnFailure: input.statusOnFailure } : {}),
        });
        setInfo(t('legacyMethods.messages.saved', { code: input.code }));
        setEditing(null);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('legacyMethods.errors.save'));
      }
    },
    [refresh],
  );

  const handleEdit = useCallback((row: AdminDeliveryMethod): void => {
    setEditing(row);
    setInfo(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm(t('legacyMethods.delivery.deleteConfirm'))) return;
      try {
        await deliveryMethodsClient.remove(id);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('legacyMethods.errors.delete'));
      }
    },
    [refresh],
  );

  if (!canRead) {
    return (
      <Alert>
        <AlertDescription>{t('legacyMethods.delivery.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <PageHeader
        title={t('legacyMethods.delivery.title')}
        description={t('legacyMethods.delivery.description')}
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

      {showDhlParcel || showInpost ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('legacyMethods.integrations.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="mb-4 text-sm text-muted-foreground">
              {t('legacyMethods.integrations.shippingDescription')}
            </p>
            {showDhlParcel ? (
              <div className="flex items-center justify-between gap-4 rounded-md border p-4">
                <div>
                  <div className="font-medium">
                    {t('legacyMethods.integrations.dhlParcel.name')}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {t('legacyMethods.integrations.dhlParcel.description')}
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to="/delivery-methods/dhl-parcel">
                    {t('legacyMethods.integrations.configure')}
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            ) : null}
            {showInpost ? (
              <div className="flex items-center justify-between gap-4 rounded-md border p-4">
                <div>
                  <div className="font-medium">{t('legacyMethods.integrations.inpost.name')}</div>
                  <div className="text-sm text-muted-foreground">
                    {t('legacyMethods.integrations.inpost.description')}
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to="/settings/inpost">
                    {t('legacyMethods.integrations.configure')}
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            {editing
              ? t('legacyMethods.delivery.editTitle', { code: editing.code })
              : t('legacyMethods.formTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <UpsertForm
            key={editing?.id ?? 'new'}
            editing={editing}
            onSubmit={handleUpsert}
            onCancel={(): void => setEditing(null)}
            orderStatuses={orderStatuses}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('legacyMethods.delivery.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('legacyMethods.columns.code')}</TableHead>
                  <TableHead>{t('legacyMethods.columns.name')}</TableHead>
                  <TableHead>Adapter</TableHead>
                  <TableHead>{t('legacyMethods.columns.cost')}</TableHead>
                  <TableHead>On success / failure</TableHead>
                  <TableHead>{t('legacyMethods.columns.status')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <code className="font-mono text-xs">{r.code}</code>
                    </TableCell>
                    <TableCell>{resolveAdminDeliveryMethodRenderer(r.rendererKey)(r)}</TableCell>
                    <TableCell>
                      <code className="font-mono text-xs">{r.adapter}</code>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatMoney(r.cost.amount, r.cost.currency)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.statusOnSuccess} / {r.statusOnFailure}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'active' ? 'success' : 'secondary'}>
                        {t(`legacyMethods.status.${r.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={(): void => handleEdit(r)}
                        >
                          <Pencil />
                          {t('common.action.edit')}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          type="button"
                          onClick={(): void => void handleDelete(r.id)}
                        >
                          <Trash2 />
                          {t('common.action.delete')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function UpsertForm({
  editing,
  onSubmit,
  onCancel,
  orderStatuses,
}: {
  editing: AdminDeliveryMethod | null;
  onSubmit: (input: {
    code: string;
    nameEn: string;
    namePl: string;
    cost: number;
    currency: string;
    status: 'active' | 'inactive';
    statusOnSuccess: string;
    statusOnFailure: string;
  }) => Promise<void>;
  onCancel: () => void;
  orderStatuses: OrderStatusOption[];
}): ReactNode {
  const t = useTranslation('core');
  const [code, setCode] = useState(editing?.code ?? '');
  const [nameEn, setNameEn] = useState(editing?.name['en-US'] ?? '');
  const [namePl, setNamePl] = useState(editing?.name['pl-PL'] ?? '');
  const [cost, setCost] = useState(editing ? String(editing.cost.amount) : '0');
  const [currency, setCurrency] = useState(editing?.cost.currency ?? 'PLN');
  const [status, setStatus] = useState<'active' | 'inactive'>(editing?.status ?? 'active');
  const [statusOnSuccess, setStatusOnSuccess] = useState(editing?.statusOnSuccess ?? '');
  const [statusOnFailure, setStatusOnFailure] = useState(editing?.statusOnFailure ?? '');
  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({
          code,
          nameEn,
          namePl,
          cost: Number(cost),
          currency,
          status,
          statusOnSuccess,
          statusOnFailure,
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="dcode">{t('legacyMethods.fields.code')}</Label>
          <Input
            id="dcode"
            value={code}
            onChange={(e): void => setCode(e.target.value)}
            required
            disabled={editing !== null}
            readOnly={editing !== null}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dnameen">{t('legacyMethods.fields.nameEn')}</Label>
          <Input id="dnameen" value={nameEn} onChange={(e): void => setNameEn(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dnamepl">{t('legacyMethods.fields.namePl')}</Label>
          <Input id="dnamepl" value={namePl} onChange={(e): void => setNamePl(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dcost">{t('legacyMethods.fields.cost')}</Label>
          <Input
            id="dcost"
            type="number"
            step="0.01"
            min="0"
            value={cost}
            onChange={(e): void => setCost(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dcur">{t('legacyMethods.fields.currency')}</Label>
          <CurrencyPicker
            id="dcur"
            value={currency}
            onChange={(e): void => setCurrency(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dstatus">{t('legacyMethods.fields.status')}</Label>
          <Select
            id="dstatus"
            value={status}
            onChange={(e): void => setStatus(e.target.value as 'active' | 'inactive')}
          >
            <option value="active">{t('legacyMethods.status.active')}</option>
            <option value="inactive">{t('legacyMethods.status.inactive')}</option>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="dsuccess">Order status on shipment success</Label>
          <Select
            id="dsuccess"
            value={statusOnSuccess}
            onChange={(e): void => setStatusOnSuccess(e.target.value)}
          >
            <option value="">(default: shipped)</option>
            {orderStatuses.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="dfailure">Order status on shipment failure</Label>
          <Select
            id="dfailure"
            value={statusOnFailure}
            onChange={(e): void => setStatusOnFailure(e.target.value)}
          >
            <option value="">(default: in_fulfilment)</option>
            {orderStatuses.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit">{t('common.action.save')}</Button>
        {editing ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('common.action.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
