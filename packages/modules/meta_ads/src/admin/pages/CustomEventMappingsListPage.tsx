import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Sparkles } from 'lucide-react';
import {
  META_STANDARD_EVENTS,
  type MetaCustomEventMapping,
  type SalesChannelSummary,
} from '@endora-commerce/contracts';
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
import { metaAdsClient, listSalesChannels } from '../api/meta-ads-client.js';
import { metaTriggerActionLabels, salesChannelLabel } from '../lib/labels.js';

const rowId = (row: MetaCustomEventMapping): string => row.id;

/**
 * Meta custom events list (feature 064, US4). Per-channel Settings (Pixel ID,
 * consent) live on the generic Settings page.
 *
 * Issue #1537 (UX audit CONTENT-20) — one shape for the three sibling
 * event-mapping lists (this one, Google Analytics custom events, LinkedIn Ads
 * conversion mappings): the kit's `ListPage`, the storefront action as the
 * row's link, a status badge with text, the channel by name, and a
 * `RowActionMenu` whose Delete asks first. The endpoint answers the whole
 * list, so there is no pager. Without the write code the list is read-only:
 * no "New", no row menu — the editor routes require that code.
 */
export default function CustomEventMappingsListPage(): ReactNode {
  const t = useTranslation('meta_ads');
  const tc = useTranslation('core');
  const { language } = useTranslationContext();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('meta_ads:write');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<MetaCustomEventMapping[]>([]);
  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const removalFocus = useRemovalFocus(rows, rowId, load.kind === 'ready');

  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading' });
    void Promise.all([
      metaAdsClient.list(),
      // A channel read failure must not hide the mappings — the channel
      // column falls back to the raw id.
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

  const actionLabel = (row: MetaCustomEventMapping): string => metaTriggerActionLabels.label(t, row.triggerAction);

  const remove = async (row: MetaCustomEventMapping): Promise<void> => {
    const deleted = await confirm({
      title: t('customEvents.deleteConfirm.title'),
      message: t('customEvents.deleteConfirm.message', { name: row.eventName }),
      confirmLabel: t('customEvents.deleteConfirm.action'),
      destructive: true,
      action: () => metaAdsClient.remove(row.id),
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
        to="/meta-ads/new"
      >
        <Plus size={16} aria-hidden="true" />
        {t('customEvents.new')}
      </Link>
    </Button>
  );
  // With no event at all the empty state carries the one create action (Von Restorff).
  const nothingYet = load.kind === 'ready' && rows.length === 0;

  const columns: ResponsiveColumn<MetaCustomEventMapping>[] = [
    {
      id: 'triggerAction',
      header: t('customEvents.triggerAction'),
      primary: true,
      render: (row) =>
        canWrite ? (
          <Link ref={removalFocus.targetRef(row)} to={`/meta-ads/${row.id}`} className="font-medium text-primary hover:underline">
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
      // Shown so an operator can see the standard event still fires alongside
      // their custom one — a mapping adds, it never replaces. Meta's own event
      // name, so it is code, not copy.
      id: 'standardEvent',
      header: t('customEvents.standardEvent'),
      hideOnMobile: true,
      render: (row) => {
        const standard = META_STANDARD_EVENTS[row.triggerAction];
        return standard ? <code className="text-xs">{standard}</code> : t('customEvents.standardEventNone');
      },
    },
    {
      id: 'salesChannel',
      header: t('customEvents.salesChannel'),
      render: (row) =>
        row.salesChannelId === null
          ? t('customEvents.allChannels')
          : salesChannelLabel(channels.find((c) => c.id === row.salesChannelId), language, row.salesChannelId),
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
        help={t('customEvents.help')}
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
                renderActions: (row: MetaCustomEventMapping) => (
                  <RowActionMenu label={t('customEvents.rowActions', { action: actionLabel(row), name: row.eventName })}>
                    <RowActionMenuItem asChild>
                      <Link to={`/meta-ads/${row.id}`}>{tc('common.action.edit')}</Link>
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
