import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { ApiError, formatMoney, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, PageHeader, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { CurrencyPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useAdminZone, AdminZone } from '@endora-commerce/admin-kit/zones';

import {
  deliveryMethodsClient,
  type AdminDeliveryMethod,
  type DeliveryMethodAdapterOption,
  type OrderStatusOption,
} from '../api/delivery-methods-client.js';
import { resolveAdminDeliveryMethodRenderer } from '../renderers/registry.js';

/**
 * How far the adapter list has got. The form needs all three answers apart: a
 * list still on its way, a list that arrived (possibly empty), and a list the
 * API refused — which must not read as "this instance has no adapters".
 */
type AdaptersState = 'loading' | 'ready' | 'error';

/**
 * The labels this module owns: its two bundled adapters. A carrier module's
 * adapter is shown by its key — the screen has no business knowing which
 * modules are carriers, so it translates nothing it did not contribute.
 */
const ADAPTER_LABEL_KEYS: Record<string, string> = {
  manual_courier: 'adapters.manual_courier.label',
  personal_pickup: 'adapters.personal_pickup.label',
};

export function DeliveryMethodsPage(): ReactNode {
  const t = useTranslation('core');
  // The adapter picker's copy lives in this module's own bundle; the rest of the
  // screen still reads the shared `core` scope it was written against.
  const tm = useTranslation('delivery_methods');
  /**
   * `useSurfaceVisibility` is the predicate the sidebar, the palette and the
   * dashboard already share, and it answers both axes at once: the operator's
   * permission and the owning module's effective presence. The DHL card below
   * was already asking both questions by hand; this is the same question in one
   * expression, which is what stops the two from drifting.
   */
  const isVisible = useSurfaceVisibility();
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
  /**
   * The integrations card is a **zone** since feature 091's batch 8 (FR-007).
   *
   * It used to hold a hard-coded `dhl_parcel` block and a hard-coded `inpost`
   * block, each carrying that module's title, description, route and permission
   * code — two `visibility-gate` couplings in
   * `backend/scripts/ledgers/foreign-module-ids.ts`, and the shape FR-007 cites
   * by name: a module reaching into another module's screen because the screen
   * offers nowhere to contribute to. Each carrier declares its own card now.
   *
   * The hook rather than `<AdminZone>` alone, because the **card** is this
   * screen's and must not render empty: `useAdminZone` has already applied both
   * axes and every contribution's own permission, so its length is the honest
   * answer to "does this operator have any integration to see", and the old
   * `showDhlParcel || showInpost` is that same question over a closed set of
   * two.
   */
  const integrations = useAdminZone('delivery_method.list.integrations', {});
  const [rows, setRows] = useState<AdminDeliveryMethod[]>([]);
  const [orderStatuses, setOrderStatuses] = useState<OrderStatusOption[]>([]);
  const [adapters, setAdapters] = useState<DeliveryMethodAdapterOption[]>([]);
  const [adaptersState, setAdaptersState] = useState<AdaptersState>('loading');
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
    setAdaptersState('loading');
    setError(null);
    try {
      const [methods, statuses, adapterOptions] = await Promise.all([
        deliveryMethodsClient.list(),
        // Shared endpoint owned by the payment-methods admin routes (feature 035);
        // gated `requireAdminAny(['payment_methods:read', 'delivery_methods:read'])`
        // since this module took its own codes, so the read code that opened this
        // screen also opens the status list.
        deliveryMethodsClient.orderStatuses().catch(() => [] as OrderStatusOption[]),
        // `null` rather than `[]` on a failure: the form says "could not load"
        // and offers a retry, where an empty list would say "none installed".
        deliveryMethodsClient.adapters().catch(() => null),
      ]);
      setRows(methods);
      setOrderStatuses(statuses);
      setAdapters(adapterOptions ?? []);
      setAdaptersState(adapterOptions === null ? 'error' : 'ready');
    } catch (err) {
      setAdaptersState('error');
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
      adapter: string;
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
          // Always sent: the API's default for a missing adapter is the code,
          // which is how a method nobody can ship came to be saved silently.
          adapter: input.adapter,
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

      {integrations.length > 0 ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('legacyMethods.integrations.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="mb-4 text-sm text-muted-foreground">
              {t('legacyMethods.integrations.shippingDescription')}
            </p>
            <AdminZone name="delivery_method.list.integrations" props={{}} />
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
            adapters={adapters}
            adaptersState={adaptersState}
            onRetryAdapters={(): void => void refresh()}
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
                  <TableHead>{tm('methods.columns.adapter')}</TableHead>
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
                      <AdapterCell method={r} />
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

/** An adapter as the operator reads it: this module's label where it has one, else the key. */
function useAdapterLabel(): (adapterKey: string) => string {
  const tm = useTranslation('delivery_methods');
  return useCallback(
    (adapterKey: string): string => {
      const labelKey = ADAPTER_LABEL_KEYS[adapterKey];
      return labelKey ? tm(labelKey) : adapterKey;
    },
    [tm],
  );
}

/**
 * The adapter a row is bound to, and — when checkout cannot offer the method —
 * that it is not offered and what brings it back.
 *
 * The reason is read from the server's `availability` projection, never from a
 * module list held here, the way the payment-methods screen reads its own. The
 * badge carries the state in words as well as colour, and the sentence names
 * the repair: an adapter nobody registered is fixed on this screen, a carrier
 * module that is off is fixed by switching it on.
 */
function AdapterCell({ method }: { method: AdminDeliveryMethod }): ReactNode {
  const tm = useTranslation('delivery_methods');
  const adapterLabel = useAdapterLabel();
  const label = adapterLabel(method.adapter);
  const { availability } = method;

  const reason = availability.available
    ? null
    : availability.ownerModule === null
      ? tm('methods.availability.noAdapter', { adapter: method.adapter })
      : availability.ownerPresence?.platformState === 'installed'
        ? tm('methods.availability.moduleOff', { module: availability.ownerModule })
        : tm('methods.availability.moduleUnavailable', { module: availability.ownerModule });

  return (
    <span className="flex flex-col items-start gap-1">
      <span>
        {label !== method.adapter ? <>{label} </> : null}
        <code className="font-mono text-xs">{method.adapter}</code>
      </span>
      {reason ? (
        <>
          <Badge variant="warning">{tm('methods.availability.unavailable')}</Badge>
          <span className="max-w-xs text-xs text-muted-foreground">{reason}</span>
        </>
      ) : null}
    </span>
  );
}

function UpsertForm({
  editing,
  onSubmit,
  onCancel,
  orderStatuses,
  adapters,
  adaptersState,
  onRetryAdapters,
}: {
  editing: AdminDeliveryMethod | null;
  onSubmit: (input: {
    code: string;
    adapter: string;
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
  adapters: DeliveryMethodAdapterOption[];
  adaptersState: AdaptersState;
  onRetryAdapters: () => void;
}): ReactNode {
  const t = useTranslation('core');
  const tm = useTranslation('delivery_methods');
  const adapterLabel = useAdapterLabel();
  const [code, setCode] = useState(editing?.code ?? '');
  // A new method starts with no adapter and the select is `required`: the
  // operator chooses, nothing is guessed from the code.
  const [adapter, setAdapter] = useState(editing?.adapter ?? '');
  // The row's own adapter stays selectable while it is not among the offered
  // ones, so opening a method and saving it never rebinds it behind the
  // operator's back; it is marked instead, and the hint says how to repair it.
  // Whether it is unavailable is the server's verdict on the row, not an
  // inference from the list — a list that failed to load proves nothing.
  const currentIsUnavailable = editing !== null && !editing.availability.available;
  const keepsCurrentOption =
    editing !== null && !adapters.some((a) => a.key === editing.adapter);
  const adapterHintId = 'dadapter-hint';
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
        // The select is `required`, which is what tells the operator; this is
        // the same rule for a submit that did not come through the browser's
        // own validation.
        if (!adapter) return;
        void onSubmit({
          code,
          adapter,
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
          <Label htmlFor="dadapter">{tm('methods.fields.adapter')}</Label>
          <Select
            id="dadapter"
            value={adapter}
            onChange={(e): void => setAdapter(e.target.value)}
            required
            disabled={adaptersState === 'loading'}
            aria-busy={adaptersState === 'loading'}
            aria-describedby={adapterHintId}
            aria-invalid={currentIsUnavailable && adapter === editing?.adapter ? true : undefined}
          >
            <option value="" disabled>
              {adaptersState === 'loading'
                ? tm('methods.adapter.loading')
                : tm('methods.adapter.placeholder')}
            </option>
            {keepsCurrentOption && editing ? (
              <option value={editing.adapter}>
                {currentIsUnavailable
                  ? tm('methods.adapter.unavailableOption', { adapter: editing.adapter })
                  : adapterLabel(editing.adapter)}
              </option>
            ) : null}
            {adapters.map((a) => (
              <option key={a.key} value={a.key}>
                {adapterLabel(a.key) === a.key ? a.key : `${adapterLabel(a.key)} (${a.key})`}
              </option>
            ))}
          </Select>
          {/* Mounted before it has anything to say, so a change is announced. */}
          <div id={adapterHintId} role="status" className="text-xs text-muted-foreground">
            {adaptersState === 'error' ? (
              <span className="flex flex-wrap items-center gap-2">
                <span>{tm('methods.adapter.loadError')}</span>
                <Button type="button" variant="outline" size="sm" onClick={onRetryAdapters}>
                  {tm('methods.adapter.retry')}
                </Button>
              </span>
            ) : adaptersState === 'ready' && adapters.length === 0 ? (
              tm('methods.adapter.empty')
            ) : currentIsUnavailable && adapter === editing?.adapter ? (
              tm('methods.adapter.currentUnavailable', { adapter: editing.adapter })
            ) : adaptersState === 'ready' ? (
              tm('methods.adapter.help')
            ) : null}
          </div>
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
export default DeliveryMethodsPage;
