import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Sparkles } from 'lucide-react';
import type { LinkedInConversionMapping, SalesChannelSummary } from '@endora-commerce/contracts';
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
import { linkedInAdsClient, listSalesChannels } from '../api/linkedin-ads-client.js';
import { linkedInTriggerActionLabels, salesChannelLabel } from '../lib/labels.js';

const rowId = (row: LinkedInConversionMapping): string => row.id;

/**
 * Conversion mappings list (feature 063, US3). Per-channel Settings (Partner ID,
 * consent, server-side, access token) live on the generic Settings page.
 *
 * Issue #1537 (UX audit CONTENT-20) — one shape for the three sibling
 * event-mapping lists (this one, Google Analytics custom events, Meta Ads
 * custom events): the kit's `ListPage`, the storefront action as the
 * row's link, a status badge with text, the channel by name, and a
 * `RowActionMenu` whose Delete asks first. The endpoint answers the whole
 * list, so there is no pager. Without the write code the list is read-only:
 * no "New", no row menu — the editor routes require that code.
 */
export default function ConversionMappingsListPage(): ReactNode {
  const t = useTranslation('linkedin_ads');
  const tc = useTranslation('core');
  const { language } = useTranslationContext();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('linkedin_ads:write');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<LinkedInConversionMapping[]>([]);
  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const removalFocus = useRemovalFocus(rows, rowId, load.kind === 'ready');

  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading' });
    void Promise.all([
      linkedInAdsClient.list(),
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

  const actionLabel = (row: LinkedInConversionMapping): string => linkedInTriggerActionLabels.label(t, row.triggerAction);

  const remove = async (row: LinkedInConversionMapping): Promise<void> => {
    const deleted = await confirm({
      title: t('mappings.deleteConfirm.title'),
      message: t('mappings.deleteConfirm.message', { name: row.conversionId }),
      confirmLabel: t('mappings.deleteConfirm.action'),
      destructive: true,
      action: () => linkedInAdsClient.remove(row.id),
      describeError: (err) =>
        err instanceof ApiError ? err.envelope.error.message : t('mappings.deleteConfirm.failed'),
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
        to="/linkedin-ads/new"
      >
        <Plus size={16} aria-hidden="true" />
        {t('mappings.new')}
      </Link>
    </Button>
  );
  // With no mapping at all the empty state carries the one create action (Von Restorff).
  const nothingYet = load.kind === 'ready' && rows.length === 0;

  const columns: ResponsiveColumn<LinkedInConversionMapping>[] = [
    {
      id: 'triggerAction',
      header: t('mappings.triggerAction'),
      primary: true,
      render: (row) =>
        canWrite ? (
          <Link ref={removalFocus.targetRef(row)} to={`/linkedin-ads/${row.id}`} className="font-medium text-primary hover:underline">
            {actionLabel(row)}
          </Link>
        ) : (
          <span className="font-medium">{actionLabel(row)}</span>
        ),
    },
    {
      id: 'conversionId',
      header: t('mappings.conversionId'),
      render: (row) => <code className="text-xs">{row.conversionId}</code>,
    },
    {
      id: 'salesChannel',
      header: t('mappings.salesChannel'),
      render: (row) =>
        row.salesChannelId === null
          ? t('mappings.allChannels')
          : salesChannelLabel(channels.find((c) => c.id === row.salesChannelId), language, row.salesChannelId),
    },
    {
      id: 'enabled',
      header: t('mappings.status'),
      render: (row) =>
        row.enabled ? (
          <Badge variant="success">{t('mappings.statusEnabled')}</Badge>
        ) : (
          <Badge variant="outline">{t('mappings.statusDisabled')}</Badge>
        ),
    },
  ];

  return (
    <>
      <ListPage
        title={t('mappings.title')}
        description={t('mappings.subtitle')}
        actions={canWrite && !nothingYet ? createLink : null}
        count={t('mappings.count', { count: rows.length })}
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
              title={t('mappings.empty')}
              description={canWrite ? t('mappings.emptyBody') : t('mappings.emptyBodyReadOnly')}
              action={canWrite ? createLink : null}
            />
          }
          {...(canWrite
            ? {
                renderActions: (row: LinkedInConversionMapping) => (
                  <RowActionMenu label={t('mappings.rowActions', { action: actionLabel(row), name: row.conversionId })}>
                    <RowActionMenuItem asChild>
                      <Link to={`/linkedin-ads/${row.id}`}>{tc('common.action.edit')}</Link>
                    </RowActionMenuItem>
                    <RowActionMenuSeparator />
                    <RowActionMenuItem destructive onSelect={() => void remove(row)}>
                      {t('mappings.delete')}
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
