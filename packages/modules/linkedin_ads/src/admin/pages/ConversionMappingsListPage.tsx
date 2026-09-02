import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LinkedInConversionMapping, SalesChannelSummary } from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import { ResponsiveTable, type ResponsiveColumn } from '@endora-commerce/admin-kit/components';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { linkedInAdsClient, listSalesChannels } from '../api/linkedin-ads-client.js';

/**
 * Conversion mappings list (feature 063, US3). Per-channel Settings (Partner ID,
 * consent, server-side, access token) live on the generic Settings page.
 */
export default function ConversionMappingsListPage(): ReactNode {
  const t = useTranslation('linkedin_ads');
  const [items, setItems] = useState<LinkedInConversionMapping[]>([]);
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
        linkedInAdsClient.list(),
        // A channel read failure must not hide the mappings themselves — the
        // channel column simply falls back to the raw id.
        listSalesChannels().catch(() => ({ items: [] })),
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

  const channelLabel = (id: string | null): string => {
    if (id === null) return t('mappings.allChannels');
    return channels.find((c) => c.id === id)?.code ?? id;
  };

  const onDelete = async (row: LinkedInConversionMapping): Promise<void> => {
    if (!window.confirm(t('mappings.deleteConfirm'))) return;
    try {
      await linkedInAdsClient.remove(row.id);
      await reload();
    } catch (err) {
      setError(messageFor(err));
    }
  };

  const columns: ResponsiveColumn<LinkedInConversionMapping>[] = [
    {
      id: 'triggerAction',
      header: t('mappings.triggerAction'),
      primary: true,
      render: (r) => t(`mappings.action.${r.triggerAction}`),
    },
    {
      id: 'conversionId',
      header: t('mappings.conversionId'),
      render: (r) => <code className="text-xs">{r.conversionId}</code>,
    },
    {
      id: 'salesChannel',
      header: t('mappings.salesChannel'),
      render: (r) => channelLabel(r.salesChannelId),
    },
    {
      id: 'enabled',
      header: t('mappings.enabled'),
      render: (r) =>
        r.enabled ? <Badge>{t('mappings.enabled')}</Badge> : <Badge variant="secondary">—</Badge>,
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('mappings.title')}
        description={t('mappings.subtitle')}
        actions={
          <Button asChild>
            <Link to="/linkedin-ads/new">{t('mappings.new')}</Link>
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
          emptyState={<p className="text-sm text-muted-foreground">{t('mappings.empty')}</p>}
          renderActions={(r) => (
            <div className="flex justify-end gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to={`/linkedin-ads/${r.id}`}>{t('mappings.edit')}</Link>
              </Button>
              <Button variant="destructive" size="sm" onClick={() => void onDelete(r)}>
                {t('mappings.delete')}
              </Button>
            </div>
          )}
        />
      )}
    </div>
  );
}
