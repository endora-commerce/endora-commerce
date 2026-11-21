import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Sparkles } from 'lucide-react';
import type { GaCustomEventResponse, SalesChannelSummary } from '@endora-commerce/contracts';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { Badge, Button, EmptyState } from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  useConfirmDialog,
  useRemovalFocus,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { googleAnalyticsClient, listSalesChannels } from '../api/google-analytics-client.js';
import { gaTriggerActionLabels, salesChannelLabel } from '../lib/labels.js';

const rowId = (row: GaCustomEventResponse): string => row.id;

/**
 * CustomEventsListPage (feature 049, US3). Per-channel Measurement ID /
 * Enhanced Ecommerce / server-side settings are managed on the generic
 * Settings screen.
 *
 * Issue #1537 (UX audit CONTENT-20) — one shape for the three sibling
 * event-mapping lists (this one, Meta Ads custom events, LinkedIn Ads
 * conversion mappings): the kit's `ListPage`, the storefront action as the
 * row's link, a status badge with text, the channel by name, and a
 * `RowActionMenu` whose Delete asks first. The endpoint answers the whole
 * list, so there is no pager. Without the write code the list is read-only:
 * no "New", no row menu — the editor routes require that code.
 */
export default function CustomEventsListPage(): ReactNode {
  const t = useTranslation('google_analytics');
  const tc = useTranslation('core');
  const { language } = useTranslationContext();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('google_analytics:write');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<GaCustomEventResponse[]>([]);
  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const removalFocus = useRemovalFocus(rows, rowId, load.kind === 'ready');

  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading' });
    void Promise.all([
      googleAnalyticsClient.list(),
      // A channel read failure must not hide the events — the channel column
      // falls back to the stored code.
      listSalesChannels().catch(() => ({ items: [] as SalesChannelSummary[] })),
    ])
      .then(([events, chans]) => {
        if (!alive) return;
        setRows(events);
        setChannels(chans.items);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoad({ kind: 'error', ...(err instanceof ApiError ? { message: err.envelope.error.message } : {}) });
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const actionLabel = (row: GaCustomEventResponse): string => gaTriggerActionLabels.label(t, row.triggerAction);

  const remove = async (row: GaCustomEventResponse): Promise<void> => {
    const deleted = await confirm({
      title: t('customEvents.deleteConfirm.title'),
      message: t('customEvents.deleteConfirm.message', { name: row.eventName }),
      confirmLabel: t('customEvents.deleteConfirm.action'),
      destructive: true,
      action: () => googleAnalyticsClient.remove(row.id),
      describeError: (err) =>
        err instanceof ApiError ? err.envelope.error.message : t('customEvents.deleteConfirm.failed'),
      returnFocusTo: removalFocus.returnFocusTo(row),
    });
    if (deleted) setRows((current) => current.filter((r) => r.id !== row.id));
  };

  const createLink = (
    <Button asChild>
      <Link
        ref={(element) => {
          removalFocus.createRef.current = element;
        }}
        to="/google-analytics/new"
      >
        <Plus size={16} aria-hidden="true" />
        {t('customEvents.new')}
      </Link>
    </Button>
  );
  // With no event at all the empty state carries the one create action (Von Restorff).
  const nothingYet = load.kind === 'ready' && rows.length === 0;

  const columns: ResponsiveColumn<GaCustomEventResponse>[] = [
    {
      id: 'triggerAction',
      header: t('customEvents.triggerAction'),
      primary: true,
      render: (row) =>
        canWrite ? (
          <Link ref={removalFocus.targetRef(row)} to={`/google-analytics/${row.id}`} className="font-medium text-primary hover:underline">
            {actionLabel(row)}
          </Link>
        ) : (
          <span className="font-medium">{actionLabel(row)}</span>
        ),
    },
    {
      id: 'eventName',
      header: t('customEvents.eventName'),
      render: (row) => <code className="text-xs">{row.eventName}</code>,
    },
    {
      id: 'salesChannel',
      header: t('customEvents.salesChannel'),
      render: (row) =>
        row.salesChannelCode === null
          ? t('customEvents.allChannels')
          : salesChannelLabel(channels.find((c) => c.code === row.salesChannelCode), language, row.salesChannelCode),
    },
    {
      id: 'enabled',
      header: t('customEvents.status'),
      render: (row) =>
        row.enabled ? (
          <Badge variant="success">{t('customEvents.statusEnabled')}</Badge>
        ) : (
          <Badge variant="outline">{t('customEvents.statusDisabled')}</Badge>
        ),
    },
  ];

  return (
    <>
      <ListPage
        title={t('customEvents.title')}
        description={t('customEvents.subtitle')}
        actions={canWrite && !nothingYet ? createLink : null}
        count={t('customEvents.count', { count: rows.length })}
        load={load}
        onRetry={() => setReloadKey((key) => key + 1)}
      >
        <ResponsiveTable
          columns={columns}
          data={rows}
          keyExtractor={rowId}
          emptyState={
            <EmptyState
              icon={<Sparkles size={20} />}
              title={t('customEvents.empty')}
              description={canWrite ? t('customEvents.emptyBody') : t('customEvents.emptyBodyReadOnly')}
              action={canWrite ? createLink : null}
            />
          }
          {...(canWrite
            ? {
                renderActions: (row: GaCustomEventResponse) => (
                  <RowActionMenu label={t('customEvents.rowActions', { action: actionLabel(row), name: row.eventName })}>
                    <RowActionMenuItem asChild>
                      <Link to={`/google-analytics/${row.id}`}>{tc('common.action.edit')}</Link>
                    </RowActionMenuItem>
                    <RowActionMenuSeparator />
                    <RowActionMenuItem destructive onSelect={() => void remove(row)}>
                      {t('customEvents.delete')}
                    </RowActionMenuItem>
                  </RowActionMenu>
                ),
              }
            : {})}
        />
      </ListPage>
      {confirmDialog}
    </>
  );
}
