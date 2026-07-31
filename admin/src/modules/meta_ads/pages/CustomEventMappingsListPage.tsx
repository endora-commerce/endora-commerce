import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  META_STANDARD_EVENTS,
  type MetaCustomEventMapping,
  type SalesChannelSummary,
} from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ResponsiveTable';
import { ApiError } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import { salesChannelsClient } from '@/modules/sales_channels/api/sales-channels-client';
import { metaAdsClient } from '../api/meta-ads-client';

/**
 * Meta custom events list (feature 064, US4). Per-channel Settings (Pixel ID,
 * consent) live on the generic Settings page.
 */
export function CustomEventMappingsListPage(): ReactNode {
  const t = useTranslation('meta_ads');
  const [items, setItems] = useState<MetaCustomEventMapping[]>([]);
  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const messageFor = useCallback(
    (err: unknown): string =>
      err instanceof ApiError ? err.envelope.error.message : t('error.generic'),
    [t],
  );

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [rows, chans] = await Promise.all([
        metaAdsClient.list(),
        // A channel read failure must not hide the mappings — the channel
        // column falls back to the raw id.
        salesChannelsClient.list({ activeOnly: false, pageSize: 100 }).catch(() => ({ items: [] })),
      ]);
      setItems(rows);
      setChannels(chans.items);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setLoading(false);
    }
  }, [messageFor]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onDelete = async (row: MetaCustomEventMapping): Promise<void> => {
    if (!window.confirm(t('customEvents.deleteConfirm'))) return;
    try {
      await metaAdsClient.remove(row.id);
      await reload();
    } catch (err) {
      setError(messageFor(err));
    }
  };

  const columns: ResponsiveColumn<MetaCustomEventMapping>[] = [
    {
      id: 'triggerAction',
      header: t('customEvents.triggerAction'),
      primary: true,
      render: (r) => t(`customEvents.action.${r.triggerAction}`),
    },
    {
      id: 'eventName',
      header: t('customEvents.eventName'),
      render: (r) => <code className="text-xs">{r.eventName}</code>,
    },
    {
      // Shown so an operator can see the standard event still fires alongside
      // their custom one — a mapping adds, it never replaces.
      id: 'standardEvent',
      header: t('customEvents.standardEvent'),
      hideOnMobile: true,
      render: (r) => META_STANDARD_EVENTS[r.triggerAction] ?? t('customEvents.standardEventNone'),
    },
    {
      id: 'salesChannel',
      header: t('customEvents.salesChannel'),
      render: (r) =>
        r.salesChannelId === null
          ? t('customEvents.allChannels')
          : (channels.find((c) => c.id === r.salesChannelId)?.code ?? r.salesChannelId),
    },
    {
      id: 'enabled',
      header: t('customEvents.enabled'),
      render: (r) =>
        r.enabled ? (
          <Badge>{t('customEvents.enabled')}</Badge>
        ) : (
          <Badge variant="secondary">—</Badge>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('customEvents.title')}
        description={t('customEvents.subtitle')}
        actions={
          <Button asChild>
            <Link to="/meta-ads/new">{t('customEvents.new')}</Link>
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? null : (
        <ResponsiveTable
          columns={columns}
          data={items}
          keyExtractor={(r) => r.id}
          emptyState={<p className="text-sm text-muted-foreground">{t('customEvents.empty')}</p>}
          renderActions={(r) => (
            <div className="flex justify-end gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to={`/meta-ads/${r.id}`}>{t('customEvents.edit')}</Link>
              </Button>
              <Button variant="destructive" size="sm" onClick={() => void onDelete(r)}>
                {t('customEvents.delete')}
              </Button>
            </div>
          )}
        />
      )}
    </div>
  );
}
