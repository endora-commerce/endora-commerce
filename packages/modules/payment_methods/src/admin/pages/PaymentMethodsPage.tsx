import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, Plus } from 'lucide-react';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';
import {
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
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, InlineStatus, Input, Label, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  paymentMethodsClient,
  type AdminPaymentMethod,
  type OrderStatusOption,
} from '../api/payment-methods-client.js';
import { resolveAdminPaymentMethodRenderer } from '../renderers/registry.js';

const KINDS = ['bank_transfer', 'pickup', 'credit_limit', 'gateway'] as const;

const rowId = (row: AdminPaymentMethod): string => row.id;

/** The server's own message where it gave one; `undefined` lets the caller fall back. */
function apiMessage(err: unknown): string | undefined {
  return err instanceof ApiError ? err.envelope.error.message : undefined;
}

/**
 * The payment-method catalogue — the kit's `ListPage` (issue #1543, UX audit
 * SALES-18). The list comes first: *New method* in the header and *Edit* in a
 * row's menu open the same form in a `ModalDialog`, beside the row the operator
 * was looking at, instead of a "New / update method" card drawn open above the
 * list (Hick: no form on screen while nobody is creating anything; Fitts /
 * Proximity: an edit opens where it was asked for). *Delete* is the row menu's
 * last entry, after a separator, and is confirmed.
 */
export function PaymentMethodsPage(): ReactNode {
  const t = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  const { hasPermission } = useAuth();
  // Feature 076 (D-83 item 6) — the gateway screens link here with the method
  // they were configuring. The row is scrolled into view **and focused**, so a
  // keyboard operator lands where they were sent rather than at the top of a
  // list they now have to search (WCAG 2.2 AA).
  const [searchParams] = useSearchParams();
  const highlight = searchParams.get('highlight');
  const highlightedRow = useRef<HTMLTableRowElement | null>(null);
  const [rows, setRows] = useState<AdminPaymentMethod[]>([]);
  const [orderStatuses, setOrderStatuses] = useState<OrderStatusOption[]>([]);
  const [adapters, setAdapters] = useState<string[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  // A refused write made from the row itself (the status select). A refused
  // save is said inside its dialog, a refused delete inside its confirmation.
  const [error, setError] = useState<string | null>(null);
  // A save is said beside the header's *New method*, where the dialog returns
  // focus — not a success banner (issues #1499 and #1543, DEC-12 a).
  const { props: statusProps, show: showStatus, clear: clearStatus } = useInlineStatus();
  // `undefined`: no dialog; `null`: creating a method; a row: editing it.
  const [dialog, setDialog] = useState<AdminPaymentMethod | null | undefined>(undefined);

  /**
   * The screen's own gate (2026-08-28), on the code its routes now enforce.
   *
   * `payment_methods` used to borrow `catalog:read`, so this page had no
   * permission of its own to check and the sidebar entry beside it carried the
   * catalogue's. Both moved together; hiding the screen rather than letting it
   * 403 is the treatment the sidebar, the palette and the dashboard already
   * apply to a denied destination, and `AppShell.tsx`'s `PALETTE_ITEMS` comment
   * argues it at length. The fetch is skipped as well as the render — a page
   * that renders nothing has no reason to ask the API three questions it will
   * be refused.
   */
  const canRead = hasPermission('payment_methods:read');
  // The code every write route enforces (`requireAdmin('payment_methods:write')`):
  // an operator without it is offered no write it would be refused.
  const canWrite = hasPermission('payment_methods:write');
  // The host owns the card, while each installed gateway owns one contribution.
  // `useAdminZone` applies platform presence, operator activation and the
  // contribution's permission before deciding whether the card exists.
  const integrations = useAdminZone('payment_method.list.integrations', {});
  // The instance's sales channels, for the form's channel field and the list's
  // channel column — loaded once, so the two cannot disagree.
  const salesChannels = useSalesChannelOptions('/api/v1/admin/payment-methods/sales-channels', canRead);
  // After a delete, focus goes to the next row, or to "New method" once the list is empty (WCAG 2.4.3).
  const removalFocus = useRemovalFocus(rows, rowId, load.kind === 'ready');

  /**
   * `silent` reads the list again without the skeleton — after a save or a
   * status change — so the rows, and the control focus returns to, stay mounted.
   */
  const refresh = useCallback(
    async (options?: { silent?: boolean }): Promise<void> => {
      if (!canRead) return;
      if (!options?.silent) setLoad({ kind: 'loading' });
      try {
        const [methods, statuses, adapterKeys] = await Promise.all([
          paymentMethodsClient.list(),
          paymentMethodsClient.orderStatuses(),
          paymentMethodsClient.adapters().catch(() => [] as string[]),
        ]);
        setRows(methods);
        setOrderStatuses(statuses);
        setAdapters(adapterKeys);
        setLoad({ kind: 'ready' });
      } catch (err) {
        const message = apiMessage(err);
        setLoad(message === undefined ? { kind: 'error' } : { kind: 'error', message });
      }
    },
    [canRead],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!highlight) return;
    const row = highlightedRow.current;
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.focus();
    // `rows` is a dependency because the row does not exist until the list has
    // loaded — running only on mount would focus nothing on every arrival.
  }, [highlight, rows, load.kind]);

  const openDialog = useCallback(
    (target: AdminPaymentMethod | null): void => {
      setError(null);
      clearStatus();
      setDialog(target);
    },
    [clearStatus],
  );

  /** Throws on a refused save, so the dialog stays open and says why. */
  const handleUpsert = useCallback(
    async (input: UpsertFormValue): Promise<void> => {
      const name: Record<string, string> = {};
      if (input.nameEn) name['en-US'] = input.nameEn;
      if (input.namePl) name['pl-PL'] = input.namePl;
      await paymentMethodsClient.upsert(input.code, {
        code: input.code,
        name,
        kind: input.kind,
        ...(input.adapter ? { adapter: input.adapter } : {}),
        additionalPrice: Number.isFinite(input.additionalPrice) ? input.additionalPrice : 0,
        status: input.status,
        ...(input.statusOnPending ? { statusOnPending: input.statusOnPending } : {}),
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

  const handleDelete = useCallback(
    async (row: AdminPaymentMethod): Promise<void> => {
      setError(null);
      clearStatus();
      // The request runs inside the dialog, so a refusal (a method payments
      // still reference) is read where the operator is looking.
      const ok = await confirm({
        message: t('legacyMethods.payment.deleteConfirm'),
        confirmLabel: t('common.action.delete'),
        destructive: true,
        action: () => paymentMethodsClient.remove(row.id),
        describeError: (err) => apiMessage(err) ?? t('legacyMethods.errors.delete'),
        returnFocusTo: removalFocus.returnFocusTo(row),
      });
      if (!ok) return;
      // In place rather than through a reload, so the row focus moved to stays mounted.
      setRows((current) => current.filter((r) => r.id !== row.id));
    },
    [t, confirm, clearStatus, removalFocus],
  );

  /**
   * The one write that decides whether a method is offered to buyers — feature
   * 076 (D-82). It is a control here and a state everywhere else: the four
   * gateway screens render the chip and link to this row.
   */
  const handleSetStatus = useCallback(
    async (row: AdminPaymentMethod, status: 'active' | 'inactive'): Promise<void> => {
      setError(null);
      clearStatus();
      try {
        await paymentMethodsClient.setStatus(row.id, status);
        await refresh({ silent: true });
      } catch (err) {
        setError(apiMessage(err) ?? t('legacyMethods.errors.save'));
      }
    },
    [refresh, t, clearStatus],
  );

  if (!canRead) {
    return (
      <Alert>
        <AlertDescription>{t('legacyMethods.payment.noPermission')}</AlertDescription>
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
        title={t('legacyMethods.payment.title')}
        actions={
          <div className="flex items-center gap-3">
            <InlineStatus {...statusProps} />
            {canWrite && !nothingYet ? newButton : null}
          </div>
        }
        load={load}
        onRetry={(): void => void refresh()}
        notice={
          error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={<CreditCard size={20} />}
            title={t('legacyMethods.payment.empty')}
            action={canWrite ? newButton : null}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('legacyMethods.columns.code')}</TableHead>
                <TableHead>{t('legacyMethods.columns.name')}</TableHead>
                <TableHead>{t('legacyMethods.columns.adapter')}</TableHead>
                <TableHead>{t('methodSalesChannels.column')}</TableHead>
                <TableHead>{t('legacyMethods.columns.status')}</TableHead>
                {canWrite ? <TableHead className="w-[1%]" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  {...(r.code === highlight
                    ? {
                        ref: highlightedRow,
                        tabIndex: -1,
                        className: 'outline-2 outline-offset-[-2px] outline-ring',
                      }
                    : {})}
                >
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
                  <TableCell>{resolveAdminPaymentMethodRenderer(r.rendererKey)(r)}</TableCell>
                  <TableCell>
                    <code className="font-mono text-xs">{r.adapter}</code>
                    {r.additionalPrice > 0 ? (
                      <span className="text-muted-foreground"> (+{r.additionalPrice})</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <MethodSalesChannelsCell
                      options={salesChannels}
                      salesChannelIds={r.salesChannelIds}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      {canWrite ? (
                        <Select
                          value={r.status}
                          aria-label={t('legacyMethods.fields.status')}
                          onChange={(e): void =>
                            void handleSetStatus(r, e.target.value as 'active' | 'inactive')
                          }
                        >
                          <option value="active">{t('legacyMethods.status.active')}</option>
                          <option value="inactive">{t('legacyMethods.status.inactive')}</option>
                        </Select>
                      ) : (
                        <Badge variant={r.status === 'active' ? 'success' : 'secondary'}>
                          {t(`legacyMethods.status.${r.status}`)}
                        </Badge>
                      )}
                      <AvailabilityNote method={r} />
                    </div>
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
            <AdminZone name="payment_method.list.integrations" props={{}} />
          </CardContent>
        </Card>
      ) : null}

      {dialog !== undefined ? (
        <UpsertDialog
          key={dialog?.id ?? 'new'}
          initial={dialog}
          adapters={adapters}
          orderStatuses={orderStatuses}
          salesChannels={salesChannels}
          onSubmit={handleUpsert}
          onClose={(): void => setDialog(undefined)}
        />
      ) : null}
      {confirmDialog}
    </>
  );
}

/**
 * Why this method is not offered to buyers (issue #96).
 *
 * A method whose gateway module is absent disappears from cart and checkout
 * entirely — the buyer never sees an option that cannot take their money — but
 * the admin keeps the row, because switching a module off drops nothing. The
 * reason is read from the server's presence projection (`availability`), never
 * from a module list held here: the frontend has no business knowing which
 * modules are gateways.
 */
function AvailabilityNote({ method }: { method: AdminPaymentMethod }): ReactNode {
  const t = useTranslation('core');
  const { availability } = method;
  if (availability.available) return null;

  const reason =
    availability.ownerModule === null
      ? t('legacyMethods.availability.noAdapter', { adapter: method.adapter })
      : availability.ownerPresence?.platformState === 'installed'
        ? t('legacyMethods.availability.moduleOff', { module: availability.ownerModule })
        : t('legacyMethods.availability.moduleUnavailable', { module: availability.ownerModule });

  return (
    <span className="flex flex-col items-start gap-1">
      <Badge variant="warning">{t('legacyMethods.availability.unavailable')}</Badge>
      <span className="text-xs text-muted-foreground">{reason}</span>
    </span>
  );
}

interface UpsertFormValue {
  code: string;
  nameEn: string;
  namePl: string;
  kind: AdminPaymentMethod['kind'];
  adapter: string;
  additionalPrice: number;
  status: 'active' | 'inactive';
  statusOnPending: string;
  statusOnSuccess: string;
  statusOnFailure: string;
  /** `undefined` leaves the method's channels as they are — see `salesChannelIdsToSubmit`. */
  salesChannelIds: string[] | undefined;
}

/**
 * The create / edit form, in a dialog opened from the header or the row
 * (issue #1543). It stays open on a refused save and says why inside itself;
 * a stray click on the scrim does not discard what was typed.
 */
function UpsertDialog({
  initial,
  adapters,
  onSubmit,
  onClose,
  orderStatuses,
  salesChannels,
}: {
  initial: AdminPaymentMethod | null;
  adapters: string[];
  onSubmit: (input: UpsertFormValue) => Promise<void>;
  onClose: () => void;
  orderStatuses: OrderStatusOption[];
  salesChannels: MethodSalesChannelOptions;
}): ReactNode {
  const t = useTranslation('core');
  const formId = useId();
  const errorId = `${formId}-error`;
  const isEdit = initial !== null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(initial?.code ?? '');
  const [nameEn, setNameEn] = useState(initial?.name['en-US'] ?? '');
  const [namePl, setNamePl] = useState(initial?.name['pl-PL'] ?? '');
  const [kind, setKind] = useState<AdminPaymentMethod['kind']>(initial?.kind ?? 'bank_transfer');
  const [adapter, setAdapter] = useState(initial?.adapter ?? '');
  const [additionalPrice, setAdditionalPrice] = useState(String(initial?.additionalPrice ?? '0'));
  const [status, setStatus] = useState<'active' | 'inactive'>(initial?.status ?? 'active');
  const [statusOnPending, setStatusOnPending] = useState(initial?.statusOnPending ?? '');
  const [statusOnSuccess, setStatusOnSuccess] = useState(initial?.statusOnSuccess ?? '');
  const [statusOnFailure, setStatusOnFailure] = useState(initial?.statusOnFailure ?? '');
  // Empty means every channel — for a new method that is the form's default,
  // and what the operator sees in the field before touching it.
  const [salesChannelIds, setSalesChannelIds] = useState<string[]>(
    initial?.salesChannelIds ?? [],
  );

  // Offer the known adapter keys, but never drop the row's current adapter even
  // if the registry list failed to load — so an edit never silently rebinds it.
  const adapterOptions = Array.from(
    new Set([...(adapter ? [adapter] : []), ...adapters]),
  );

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        code,
        nameEn,
        namePl,
        kind,
        adapter,
        additionalPrice: Number(additionalPrice),
        status,
        statusOnPending,
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
  ): ReactNode => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onChange={(e): void => setValue(e.target.value)}>
        <option value="">—</option>
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
        isEdit
          ? t('legacyMethods.editTitle', { code: initial.code })
          : t('legacyMethods.payment.newTitle')
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
            <Label htmlFor="pmcode">{t('legacyMethods.fields.code')}</Label>
            <Input
              id="pmcode"
              value={code}
              onChange={(e): void => setCode(e.target.value)}
              required
              disabled={isEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pmkind">{t('legacyMethods.fields.kind')}</Label>
            <Select
              id="pmkind"
              value={kind}
              onChange={(e): void => setKind(e.target.value as AdminPaymentMethod['kind'])}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`legacyMethods.payment.kind.${k}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pmnameen">{t('legacyMethods.fields.nameEn')}</Label>
            <Input id="pmnameen" value={nameEn} onChange={(e): void => setNameEn(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pmnamepl">{t('legacyMethods.fields.namePl')}</Label>
            <Input id="pmnamepl" value={namePl} onChange={(e): void => setNamePl(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pmadapter">{t('legacyMethods.fields.adapter')}</Label>
            <Select
              id="pmadapter"
              value={adapter}
              onChange={(e): void => setAdapter(e.target.value)}
            >
              {/* Empty = let the backend default the adapter to the selected kind. */}
              <option value="">
                {t('legacyMethods.fields.adapterDefault', {
                  kind: t(`legacyMethods.payment.kind.${kind}`),
                })}
              </option>
              {adapterOptions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pmprice">{t('legacyMethods.fields.additionalPrice')}</Label>
            <Input
              id="pmprice"
              type="number"
              min="0"
              step="0.01"
              value={additionalPrice}
              onChange={(e): void => setAdditionalPrice(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pmstatus">{t('legacyMethods.fields.status')}</Label>
            <Select
              id="pmstatus"
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
        {/* The three order-status mappings are one decision, so they are one group (Chunking). */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t('legacyMethods.payment.statusGroup')}</legend>
          <div className="grid gap-4 md:grid-cols-2">
            {statusSelect('pmsop', t('legacyMethods.fields.statusOnPending'), statusOnPending, setStatusOnPending)}
            {statusSelect('pmsos', t('legacyMethods.fields.statusOnSuccess'), statusOnSuccess, setStatusOnSuccess)}
            {statusSelect('pmsof', t('legacyMethods.fields.statusOnFailure'), statusOnFailure, setStatusOnFailure)}
          </div>
        </fieldset>
      </form>
    </ModalDialog>
  );
}

/**
 * The default export the route declaration's dynamic-import factory takes
 * (`contracts/admin-contribution.md` R6). The named export is kept because the
 * screen is also the subject of this module's own admin tests.
 */
export default PaymentMethodsPage;
