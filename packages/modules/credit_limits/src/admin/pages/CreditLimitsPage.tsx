import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Loader2, Plus } from 'lucide-react';
import { ApiError, apiClient, formatDateTime, formatMoney } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  EmptyState,
  FormField,
  InlineStatus,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import {
  CurrencyPicker,
  ListPage,
  ModalDialog,
  OrganizationPicker,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  useListPagination,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { moneyDifference, type CreditLimitListResponse, type CreditLimitView } from '@endora-commerce/contracts';

/** `GET /api/v1/admin/credit-limits` serves at most 200 rows a page (issue #1664). */
const MAX_PAGE_SIZE = 200;

/** What the open dialog is for: a grant from the header, or one organization's limit from its row. */
type DialogTarget = { kind: 'grant' } | { kind: 'organization'; organizationId: string; name: string | null };

/** The display name of an organization the screen may only know by id. */
const nameOf = (organizationId: string, name: string | null | undefined): string => name ?? organizationId.slice(0, 8);

/**
 * The credit-limits list (US6; issue #1664, UX audit SALES-24 and SALES-19):
 * the kit `ListPage`, server-paged. *Grant credit limit* in the header and
 * *Adjust limit* in a row's menu open one dialog, which grants a limit to an
 * organization holding none and adjusts the one an organization holds — the
 * look-up card that used to sit under the list, with the editor drawn below it
 * off screen, is gone.
 */
export function CreditLimitsPage(): ReactNode {
  const t = useTranslation('core');
  const tc = useTranslation('credit_limits');
  const pager = useListPagination({ scope: 'credit-limits', maxPageSize: MAX_PAGE_SIZE });
  const { syncTotal } = pager;
  const status = useInlineStatus();
  const { clear: clearStatus, show: showStatus } = status;
  const [rows, setRows] = useState<CreditLimitView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  /** Why the list could not be read; `undefined` inside is the kit's generic copy. */
  const [loadError, setLoadError] = useState<{ message: string | undefined } | null>(null);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);

  const { page, pageSize } = pager.query;
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.get<CreditLimitListResponse>(
        `/api/v1/admin/credit-limits?page=${page}&pageSize=${pageSize}`,
      );
      setRows(res.data);
      setTotal(res.meta.total);
      syncTotal(res.meta.total);
    } catch (err) {
      setLoadError({ message: err instanceof ApiError ? err.envelope.error.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, syncTotal]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openDialog = useCallback(
    (target: DialogTarget): void => {
      clearStatus();
      setDialog(target);
    },
    [clearStatus],
  );

  const done = useCallback(
    (message: string): void => {
      setDialog(null);
      showStatus(message);
      void refresh();
    },
    [showStatus, refresh],
  );

  const columns: ResponsiveColumn<CreditLimitView>[] = [
    {
      id: 'organization',
      header: t('creditLimits.column.organization'),
      primary: true,
      render: (r) =>
        r.organizationName ? (
          <span className="font-medium">{r.organizationName}</span>
        ) : (
          <code className="font-mono text-xs">{r.organizationId.slice(0, 8)}</code>
        ),
      meta: (r) => formatMoney(r.availableAmount, r.currency),
    },
    {
      id: 'granted',
      header: t('creditLimits.column.granted'),
      render: (r) => <span className="tabular-nums">{formatMoney(r.grantedAmount, r.currency)}</span>,
    },
    {
      id: 'available',
      header: t('creditLimits.column.available'),
      hideOnMobile: true,
      render: (r) => <span className="tabular-nums">{formatMoney(r.availableAmount, r.currency)}</span>,
    },
    {
      id: 'reservations',
      header: t('creditLimits.column.reservations'),
      hideOnMobile: true,
      render: (r) => <span className="tabular-nums">{r.activeReservationCount}</span>,
    },
    {
      id: 'grantedAt',
      header: t('creditLimits.column.grantedAt'),
      hideOnMobile: true,
      render: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.grantedAt)}</span>,
    },
  ];

  const load: ListPageLoad = loading
    ? { kind: 'loading' }
    : loadError !== null
      ? loadError.message === undefined
        ? { kind: 'error' }
        : { kind: 'error', message: loadError.message }
      : { kind: 'ready' };

  const grantButton = (
    <Button type="button" onClick={(): void => openDialog({ kind: 'grant' })}>
      <Plus aria-hidden="true" />
      {tc('list.grant')}
    </Button>
  );

  return (
    <>
      <ListPage
        title={t('creditLimits.page.title')}
        // While the list is empty, the empty state's Grant is the view's one primary (kit README).
        actions={load.kind === 'ready' && total === 0 ? null : grantButton}
        load={load}
        onRetry={(): void => void refresh()}
        count={tc('list.count', { count: total })}
        notice={<InlineStatus {...status.props} />}
        pagination={pager.footer(total)}
      >
        <ResponsiveTable
          data={rows}
          keyExtractor={(r) => r.organizationId}
          columns={columns}
          emptyState={
            <EmptyState
              icon={<CreditCard size={20} />}
              title={tc('list.emptyTitle')}
              description={tc('list.empty')}
              action={grantButton}
            />
          }
          renderActions={(r) => (
            <RowActionMenu label={tc('list.rowMenu.label', { name: nameOf(r.organizationId, r.organizationName) })}>
              <RowActionMenuItem
                onSelect={(): void =>
                  openDialog({ kind: 'organization', organizationId: r.organizationId, name: r.organizationName ?? null })
                }
              >
                {tc('list.adjust')}
              </RowActionMenuItem>
              <RowActionMenuItem asChild>
                <Link to={`/organizations/${r.organizationId}`}>{tc('list.openOrganization')}</Link>
              </RowActionMenuItem>
            </RowActionMenu>
          )}
        />
      </ListPage>
      {dialog ? <CreditLimitDialog target={dialog} onClose={(): void => setDialog(null)} onDone={done} /> : null}
    </>
  );
}

/** What the dialog knows about the organization's limit. */
type Lookup =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'granted'; limit: CreditLimitView }
  | { kind: 'none' };

/**
 * Grant or adjust, in one dialog. Opened from the header it first asks for the
 * organization; opened from a row it is that organization's. Either way it
 * reads the organization's limit, and draws the grant form for one holding
 * none, the adjust form for one holding one. A refused request stays in the
 * dialog with the server's message; a successful one closes it.
 */
function CreditLimitDialog({
  target,
  onClose,
  onDone,
}: {
  target: DialogTarget;
  onClose: () => void;
  onDone: (message: string) => void;
}): ReactNode {
  const t = useTranslation('core');
  const tc = useTranslation('credit_limits');
  const formId = useId();
  const [organizationId, setOrganizationId] = useState<string | null>(
    target.kind === 'organization' ? target.organizationId : null,
  );
  const [organizationName, setOrganizationName] = useState<string | null>(
    target.kind === 'organization' ? target.name : null,
  );
  const [lookup, setLookup] = useState<Lookup>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setError(null);
    if (!organizationId) {
      setLookup({ kind: 'idle' });
      return undefined;
    }
    let live = true;
    setLookup({ kind: 'loading' });
    void (async (): Promise<void> => {
      try {
        const res = await apiClient.get<{ data: CreditLimitView }>(`/api/v1/admin/organizations/${organizationId}/credit-limit`);
        if (!live) return;
        setLookup({ kind: 'granted', limit: res.data });
        if (res.data.organizationName) setOrganizationName(res.data.organizationName);
      } catch (err) {
        if (!live) return;
        if (err instanceof ApiError && err.envelope.error.code === 'CREDIT_LIMIT_NOT_GRANTED') {
          setLookup({ kind: 'none' });
          // No limit ⇒ no name from the credit-limit payload. Best-effort resolve
          // it, so the grant names the organization (the id prefix otherwise).
          try {
            const org = await apiClient.get<{ data: { name: string } }>(`/api/v1/admin/organizations/${organizationId}`);
            if (live) setOrganizationName(org.data.name);
          } catch {
            /* keep the id-prefix fallback */
          }
        } else {
          setLookup({ kind: 'idle' });
          setError(err instanceof ApiError ? err.envelope.error.message : t('creditLimits.error.lookup'));
        }
      }
    })();
    return (): void => {
      live = false;
    };
  }, [organizationId, t]);

  const run = async (request: () => Promise<unknown>, success: string, fallback: string): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await request();
      setSaving(false);
      onDone(success);
    } catch (err) {
      setSaving(false);
      setError(err instanceof ApiError ? err.envelope.error.message : fallback);
    }
  };

  const shownName = organizationId ? nameOf(organizationId, organizationName) : '';

  const handleGrant = (input: { grantedAmount: number; currency: string; reason?: string }): void => {
    if (!organizationId) return;
    void run(
      () => apiClient.post<{ data: CreditLimitView }>(`/api/v1/admin/organizations/${organizationId}/credit-limit`, input),
      t('creditLimits.success.grant', { amount: input.grantedAmount, currency: input.currency, orgId: shownName }),
      t('creditLimits.error.grant'),
    );
  };

  const handleAdjust = (input: { grantedAmount: number; reason?: string; allowOverAllocation: boolean }): void => {
    if (!organizationId) return;
    void run(
      () => apiClient.patch<{ data: CreditLimitView }>(`/api/v1/admin/organizations/${organizationId}/credit-limit`, input),
      t('creditLimits.success.adjust', { orgId: shownName }),
      t('creditLimits.error.adjust'),
    );
  };

  const title =
    lookup.kind === 'granted'
      ? t('creditLimits.adjust.title', { orgId: shownName, currency: lookup.limit.currency })
      : lookup.kind === 'none' && target.kind === 'organization'
        ? t('creditLimits.grant.title', { orgId: shownName })
        : tc('list.grant');

  const ready = lookup.kind === 'granted' || lookup.kind === 'none';

  return (
    <ModalDialog
      title={title}
      onClose={onClose}
      busy={saving}
      dismissOnScrim={false}
      widthClassName="max-w-2xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('common.action.cancel')}
          </Button>
          {ready ? (
            <Button type="submit" form={formId} disabled={saving} aria-busy={saving || undefined}>
              {saving ? <Loader2 size={14} aria-hidden="true" className="motion-safe:animate-spin" /> : null}
              {lookup.kind === 'granted' ? t('creditLimits.action.saveAdjust') : t('creditLimits.action.grant')}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        {target.kind === 'grant' ? (
          <FormField label={tc('dialog.organization')} hint={tc('dialog.pickOrganization')}>
            {(control) => (
              <OrganizationPicker
                id={control.id}
                value={organizationId}
                onChange={(id): void => {
                  setOrganizationName(null);
                  setOrganizationId(id);
                }}
              />
            )}
          </FormField>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {lookup.kind === 'loading' ? <p className="text-sm text-muted-foreground">{tc('dialog.checking')}</p> : null}
        {lookup.kind === 'granted' ? (
          <AdjustForm key={lookup.limit.organizationId} formId={formId} limit={lookup.limit} onAdjust={handleAdjust} />
        ) : null}
        {lookup.kind === 'none' ? <GrantForm key={organizationId} formId={formId} onGrant={handleGrant} /> : null}
      </div>
    </ModalDialog>
  );
}

function AdjustForm({
  formId,
  limit,
  onAdjust,
}: {
  formId: string;
  limit: CreditLimitView;
  onAdjust: (input: { grantedAmount: number; reason?: string; allowOverAllocation: boolean }) => void;
}): ReactNode {
  const t = useTranslation('core');
  const [grantedAmount, setGrantedAmount] = useState(String(limit.grantedAmount));
  const [reason, setReason] = useState('');
  const [allowOverAllocation, setAllowOverAllocation] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('creditLimits.adjust.summary', {
          granted: limit.grantedAmount.toFixed(2),
          available: limit.availableAmount.toFixed(2),
          reserved: moneyDifference(limit.grantedAmount, limit.availableAmount),
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
                  {/* Issue #1178 — the order's customer-facing number, the one the
                      orders list shows, opening the admin order (as the invoices
                      list does); the short id only for a server that answered none. */}
                  <Link to={`/orders/${r.orderId}`} className="font-mono text-xs underline underline-offset-2">
                    {r.orderBusinessId ?? r.orderId.slice(0, 8)}
                  </Link>
                </TableCell>
                <TableCell>{formatMoney(r.amount, limit.currency)}</TableCell>
                <TableCell>{formatDateTime(r.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e: FormEvent): void => {
          e.preventDefault();
          onAdjust({
            grantedAmount: Number(grantedAmount),
            ...(reason ? { reason } : {}),
            allowOverAllocation,
          });
        }}
      >
        <FormField label={t('creditLimits.field.newGranted', { currency: limit.currency })} required>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={grantedAmount}
            onChange={(e): void => setGrantedAmount(e.target.value)}
            required
          />
        </FormField>
        <FormField label={t('creditLimits.field.reasonAudit')}>
          <Input value={reason} onChange={(e): void => setReason(e.target.value)} maxLength={2000} />
        </FormField>
        <label className="inline-flex items-center gap-2 text-sm">
          <Checkbox checked={allowOverAllocation} onChange={(e): void => setAllowOverAllocation(e.target.checked)} />
          {t('creditLimits.field.allowOverAllocation')}
        </label>
      </form>
    </div>
  );
}

function GrantForm({
  formId,
  onGrant,
}: {
  formId: string;
  onGrant: (input: { grantedAmount: number; currency: string; reason?: string }) => void;
}): ReactNode {
  const t = useTranslation('core');
  const [grantedAmount, setGrantedAmount] = useState('5000');
  const [currency, setCurrency] = useState('PLN');
  const [reason, setReason] = useState('');
  return (
    <form
      id={formId}
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        onGrant({
          grantedAmount: Number(grantedAmount),
          currency,
          ...(reason ? { reason } : {}),
        });
      }}
    >
      <p className="text-sm text-muted-foreground">{t('creditLimits.grant.notGrantedYet')}</p>
      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <FormField label={t('creditLimits.field.grantedAmount')} required>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={grantedAmount}
            onChange={(e): void => setGrantedAmount(e.target.value)}
            required
          />
        </FormField>
        <FormField label={t('creditLimits.field.currency')} required>
          <CurrencyPicker value={currency} onChange={(e): void => setCurrency(e.target.value)} required />
        </FormField>
      </div>
      <FormField label={t('creditLimits.field.reasonOptional')}>
        <Input value={reason} onChange={(e): void => setReason(e.target.value)} maxLength={2000} />
      </FormField>
    </form>
  );
}

export default CreditLimitsPage;
