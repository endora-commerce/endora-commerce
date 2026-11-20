import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, Truck } from 'lucide-react';
import { ApiError, formatMoney, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, InlineStatus, Input, Label, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import {
  CurrencyPicker,
  ListPage,
  MethodSalesChannelsCell,
  MethodSalesChannelsField,
  ModalDialog,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  salesChannelIdsToSubmit,
  useConfirmDialog,
  useRemovalFocus,
  useSalesChannelOptions,
  type ListPageLoad,
  type MethodSalesChannelOptions,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useAdminZone, AdminZone } from '@endora-commerce/admin-kit/zones';

import {
  deliveryMethodsClient,
  type AdminDeliveryMethod,
  type DeliveryMethodAdapterOption,
  type OrderStatusOption,
} from '../api/delivery-methods-client.js';
import { resolveAdminDeliveryMethodRenderer } from '../renderers/registry.js';

const rowId = (row: AdminDeliveryMethod): string => row.id;

/** The server's own message where it gave one; `undefined` lets the caller fall back. */
function apiMessage(err: unknown): string | undefined {
  return err instanceof ApiError ? err.envelope.error.message : undefined;
}

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

/**
 * The delivery-method catalogue — the kit's `ListPage` (issue #1543, UX audit
 * SALES-18). The list comes first: *New method* in the header and *Edit* in a
 * row's menu open the same form in a `ModalDialog`, instead of a "New / update
 * method" card drawn open above the list (Hick; Fitts / Proximity). *Delete*
 * is the row menu's last entry, after a separator, and is confirmed.
 */
export function DeliveryMethodsPage(): ReactNode {
  const t = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
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
  // The instance's sales channels, for the form's channel field and the list's
  // channel column — loaded once, so the two cannot disagree.
  const salesChannels = useSalesChannelOptions('/api/v1/admin/delivery-methods/sales-channels', canRead);
  // The code every write route enforces (`requireAdmin('delivery_methods:write')`):
  // an operator without it is offered no write it would be refused.
  const canWrite = isVisible({
    module: 'delivery_methods',
    requiredPermission: 'delivery_methods:write',
  });
  const [rows, setRows] = useState<AdminDeliveryMethod[]>([]);
  const [orderStatuses, setOrderStatuses] = useState<OrderStatusOption[]>([]);
  const [adapters, setAdapters] = useState<DeliveryMethodAdapterOption[]>([]);
  const [adaptersState, setAdaptersState] = useState<AdaptersState>('loading');
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  // A save is said beside the header's *New method*, where the dialog returns
  // focus — not a success banner (issues #1499 and #1543, DEC-12 a).
  const { props: statusProps, show: showStatus, clear: clearStatus } = useInlineStatus();
  // `undefined`: no dialog; `null`: creating a method; a row: editing it.
  const [dialog, setDialog] = useState<AdminDeliveryMethod | null | undefined>(undefined);
  // After a delete, focus goes to the next row, or to "New method" once the list is empty (WCAG 2.4.3).
  const removalFocus = useRemovalFocus(rows, rowId, load.kind === 'ready');

  /**
   * `silent` reads the list again without the skeleton — after a save, or the
   * dialog's adapter retry — so the rows, and the control focus returns to,
   * stay mounted.
   */
  const refresh = useCallback(
    async (options?: { silent?: boolean }): Promise<void> => {
      if (!canRead) return;
      if (!options?.silent) setLoad({ kind: 'loading' });
      setAdaptersState('loading');
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
        setLoad({ kind: 'ready' });
      } catch (err) {
        setAdaptersState('error');
        const message = apiMessage(err);
        setLoad(message === undefined ? { kind: 'error' } : { kind: 'error', message });
      }
    },
    [canRead],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Throws on a refused save, so the dialog stays open and says why. */
  const handleUpsert = useCallback(
    async (input: UpsertFormValue): Promise<void> => {
      const name: Record<string, string> = {};
      if (input.nameEn) name['en-US'] = input.nameEn;
      if (input.namePl) name['pl-PL'] = input.namePl;
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
        ...(input.salesChannelIds !== undefined
          ? { salesChannelIds: input.salesChannelIds }
          : {}),
      });
      setDialog(undefined);
      showStatus(t('legacyMethods.messages.saved', { code: input.code }));
      await refresh({ silent: true });
    },
    [refresh, t, showStatus],
  );

  const openDialog = useCallback(
    (target: AdminDeliveryMethod | null): void => {
      clearStatus();
      setDialog(target);
    },
    [clearStatus],
  );

  const handleDelete = useCallback(
    async (row: AdminDeliveryMethod): Promise<void> => {
      clearStatus();
      // The request runs inside the dialog, so a refusal (a method shipments
      // still reference) is read where the operator is looking.
      const ok = await confirm({
        message: t('legacyMethods.delivery.deleteConfirm'),
        confirmLabel: t('common.action.delete'),
        destructive: true,
        action: () => deliveryMethodsClient.remove(row.id),
        describeError: (err) => apiMessage(err) ?? t('legacyMethods.errors.delete'),
        returnFocusTo: removalFocus.returnFocusTo(row),
      });
      if (!ok) return;
      // In place rather than through a reload, so the row focus moved to stays mounted.
      setRows((current) => current.filter((r) => r.id !== row.id));
    },
    [t, confirm, clearStatus, removalFocus],
  );

  /** An order status as the operator reads it: its label where the list has one, else its code. */
  const statusLabel = (code: string): string =>
    orderStatuses.find((s) => s.code === code)?.label ?? code;

  if (!canRead) {
    return (
      <Alert>
        <AlertDescription>{t('legacyMethods.delivery.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  const newButton = (
    <Button
      ref={(element) => {
        removalFocus.createRef.current = element;
      }}
      type="button"
      onClick={(): void => openDialog(null)}
    >
      <Plus aria-hidden="true" />
      {t('legacyMethods.action.new')}
    </Button>
  );
  // With no method at all the empty state carries the one create action (Von Restorff);
  // while the list loads it is not known yet which of the two will hold it.
  const nothingYet = load.kind === 'loading' || (load.kind === 'ready' && rows.length === 0);

  return (
    <>
      <ListPage
        title={t('legacyMethods.delivery.title')}
        description={t('legacyMethods.delivery.description')}
        actions={
          <div className="flex items-center gap-3">
            <InlineStatus {...statusProps} />
            {canWrite && !nothingYet ? newButton : null}
          </div>
        }
        load={load}
        onRetry={(): void => void refresh()}
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={<Truck size={20} />}
            title={t('legacyMethods.delivery.empty')}
            action={canWrite ? newButton : null}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('legacyMethods.columns.code')}</TableHead>
                <TableHead>{t('legacyMethods.columns.name')}</TableHead>
                <TableHead>{tm('methods.columns.adapter')}</TableHead>
                <TableHead>{t('legacyMethods.columns.cost')}</TableHead>
                <TableHead>{tm('methods.columns.statuses')}</TableHead>
                <TableHead>{t('methodSalesChannels.column')}</TableHead>
                <TableHead>{t('legacyMethods.columns.status')}</TableHead>
                {canWrite ? <TableHead className="w-[1%]" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {canWrite ? (
                      // The method has no page of its own: its code opens the edit dialog, like the menu's *Edit*.
                      <button
                        ref={removalFocus.targetRef(r)}
                        type="button"
                        className="rounded-sm text-left font-mono text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={(): void => openDialog(r)}
                      >
                        {r.code}
                      </button>
                    ) : (
                      <code className="font-mono text-xs">{r.code}</code>
                    )}
                  </TableCell>
                  <TableCell>{resolveAdminDeliveryMethodRenderer(r.rendererKey)(r)}</TableCell>
                  <TableCell>
                    <AdapterCell method={r} />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatMoney(r.cost.amount, r.cost.currency)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {statusLabel(r.statusOnSuccess)} / {statusLabel(r.statusOnFailure)}
                  </TableCell>
                  <TableCell>
                    <MethodSalesChannelsCell
                      options={salesChannels}
                      salesChannelIds={r.salesChannelIds}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.status === 'active' ? 'success' : 'secondary'}>
                      {t(`legacyMethods.status.${r.status}`)}
                    </Badge>
                  </TableCell>
                  {canWrite ? (
                    <TableCell>
                      <div className="flex justify-end">
                        <RowActionMenu label={t('legacyMethods.rowActions', { code: r.code })}>
                          <RowActionMenuItem onSelect={(): void => openDialog(r)}>
                            {t('common.action.edit')}
                          </RowActionMenuItem>
                          <RowActionMenuSeparator />
                          <RowActionMenuItem destructive onSelect={(): void => void handleDelete(r)}>
                            {t('common.action.delete')}
                          </RowActionMenuItem>
                        </RowActionMenu>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListPage>

      {integrations.length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{t('legacyMethods.integrations.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <AdminZone name="delivery_method.list.integrations" props={{}} />
          </CardContent>
        </Card>
      ) : null}

      {dialog !== undefined ? (
        <UpsertDialog
          key={dialog?.id ?? 'new'}
          editing={dialog}
          onSubmit={handleUpsert}
          onClose={(): void => setDialog(undefined)}
          orderStatuses={orderStatuses}
          adapters={adapters}
          adaptersState={adaptersState}
          onRetryAdapters={(): void => void refresh({ silent: true })}
          salesChannels={salesChannels}
        />
      ) : null}
      {confirmDialog}
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

interface UpsertFormValue {
  code: string;
  adapter: string;
  nameEn: string;
  namePl: string;
  cost: number;
  currency: string;
  status: 'active' | 'inactive';
  statusOnSuccess: string;
  statusOnFailure: string;
  /** `undefined` leaves the method's channels as they are — see `salesChannelIdsToSubmit`. */
  salesChannelIds: string[] | undefined;
}

/**
 * The order statuses a new method is created with when its mapping is left
 * empty — the server's defaults (`delivery-method.commands.ts`), named here so
 * the empty option says which status it means. The hard-coded "(default:
 * shipped)" / "(default: in_fulfilment)" this replaces named neither.
 */
const DEFAULT_STATUS_ON_SUCCESS = 'shipment_sent';
const DEFAULT_STATUS_ON_FAILURE = 'processing';

/**
 * The create / edit form, in a dialog opened from the header or the row
 * (issue #1543). It stays open on a refused save and says why inside itself;
 * a stray click on the scrim does not discard what was typed.
 */
function UpsertDialog({
  editing,
  onSubmit,
  onClose,
  orderStatuses,
  adapters,
  adaptersState,
  onRetryAdapters,
  salesChannels,
}: {
  editing: AdminDeliveryMethod | null;
  onSubmit: (input: UpsertFormValue) => Promise<void>;
  onClose: () => void;
  orderStatuses: OrderStatusOption[];
  adapters: DeliveryMethodAdapterOption[];
  adaptersState: AdaptersState;
  onRetryAdapters: () => void;
  salesChannels: MethodSalesChannelOptions;
}): ReactNode {
  const t = useTranslation('core');
  const tm = useTranslation('delivery_methods');
  const adapterLabel = useAdapterLabel();
  const formId = useId();
  const errorId = `${formId}-error`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  // Empty means every channel — for a new method that is the form's default,
  // and what the operator sees in the field before touching it.
  const [salesChannelIds, setSalesChannelIds] = useState<string[]>(
    editing?.salesChannelIds ?? [],
  );

  /** An order status as the operator reads it: its label where the list has one, else its code. */
  const statusLabel = (statusCode: string): string =>
    orderStatuses.find((s) => s.code === statusCode)?.label ?? statusCode;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    // The select is `required`, which is what tells the operator; this is
    // the same rule for a submit that did not come through the browser's
    // own validation.
    if (busy || !adapter) return;
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        code,
        adapter,
        nameEn,
        namePl,
        cost: Number(cost),
        currency,
        status,
        statusOnSuccess,
        statusOnFailure,
        salesChannelIds: salesChannelIdsToSubmit(salesChannels, salesChannelIds),
      });
    } catch (err) {
      setError(apiMessage(err) ?? t('legacyMethods.errors.save'));
      setBusy(false);
    }
  };

  const statusSelect = (
    id: string,
    label: string,
    value: string,
    setValue: (v: string) => void,
    fallback: string,
  ): ReactNode => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onChange={(e): void => setValue(e.target.value)}>
        <option value="">{tm('methods.fields.statusDefault', { status: statusLabel(fallback) })}</option>
        {orderStatuses.map((s) => (
          <option key={s.code} value={s.code}>
            {s.label}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <ModalDialog
      title={
        editing
          ? t('legacyMethods.delivery.editTitle', { code: editing.code })
          : t('legacyMethods.delivery.newTitle')
      }
      onClose={onClose}
      busy={busy}
      dismissOnScrim={false}
      widthClassName="max-w-2xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('common.action.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy} aria-busy={busy}>
            {t('common.action.save')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        aria-describedby={error ? errorId : undefined}
        onSubmit={(e): void => void submit(e)}
      >
        {error ? (
          <Alert variant="destructive" id={errorId}>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
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
          <MethodSalesChannelsField
            options={salesChannels}
            value={salesChannelIds}
            onChange={setSalesChannelIds}
          />
        </div>
        {/* The two order-status mappings are one decision, so they are one group (Chunking). */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{tm('methods.statusGroup')}</legend>
          <div className="grid gap-4 md:grid-cols-2">
            {statusSelect(
              'dsuccess',
              tm('methods.fields.statusOnSuccess'),
              statusOnSuccess,
              setStatusOnSuccess,
              DEFAULT_STATUS_ON_SUCCESS,
            )}
            {statusSelect(
              'dfailure',
              tm('methods.fields.statusOnFailure'),
              statusOnFailure,
              setStatusOnFailure,
              DEFAULT_STATUS_ON_FAILURE,
            )}
          </div>
        </fieldset>
      </form>
    </ModalDialog>
  );
}
export default DeliveryMethodsPage;
