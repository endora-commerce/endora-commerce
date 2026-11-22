import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Plus } from 'lucide-react';
import type { CampaignSummary } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, EmptyState } from '@endora-commerce/admin-kit/ui';
import { ListPage, ResponsiveTable, type ListPageLoad } from '@endora-commerce/admin-kit/components';
import { newsletterClient } from '../api/newsletter-client.js';
import { campaignStatusLabels, campaignTargetLabels } from '../lib/labels.js';

/**
 * The newsletter campaigns. The kit's `ListPage` since issue #1749: the
 * loading, error and empty states are the kit's, and while there is no
 * campaign the empty state carries the one *New campaign*. The endpoint
 * answers every campaign, unpaged.
 */
export function CampaignsPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const t = useTranslation('newsletter');
  const canWrite = hasPermission('newsletter:write');
  const [items, setItems] = useState<CampaignSummary[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });

  const refresh = useCallback((): void => {
    setLoad({ kind: 'loading' });
    newsletterClient
      .listCampaigns()
      .then((res) => {
        setItems(res.items);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => setLoad({ kind: 'error', message: err instanceof Error ? err.message : String(err) }));
  }, []);

  useEffect(() => refresh(), [refresh]);

  if (!hasPermission('newsletter:read')) {
    return (
      <Alert>
        <AlertDescription>{t('common.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  const newCampaign = (
    <Button asChild>
      <Link to="/newsletter/campaigns/new">
        <Plus aria-hidden="true" />
        {t('campaigns.new')}
      </Link>
    </Button>
  );
  // While there is none, the empty state's New campaign is the view's one primary (Von Restorff).
  const nothingYet = load.kind === 'ready' && items.length === 0;

  return (
    <ListPage
      title={t('campaigns.title')}
      actions={canWrite && !nothingYet ? newCampaign : null}
      count={t('campaigns.count', { count: items.length })}
      load={load}
      onRetry={refresh}
    >
      <ResponsiveTable
        data={items}
        keyExtractor={(c) => c.id}
        emptyState={<EmptyState icon={<Mail size={20} />} title={t('campaigns.empty')} action={canWrite ? newCampaign : null} />}
        columns={[
          {
            id: 'name',
            header: t('common.column.name'),
            primary: true,
            render: (c) => (
              <Link className="font-medium text-primary hover:underline" to={`/newsletter/campaigns/${c.id}`}>
                {c.name}
              </Link>
            ),
            meta: (c) => c.subject,
          },
          { id: 'subject', header: t('campaigns.column.subject'), hideOnMobile: true, render: (c) => c.subject },
          { id: 'audience', header: t('campaigns.column.audience'), render: (c) => campaignTargetLabels.label(t, c.targetType) },
          { id: 'status', header: t('common.column.status'), render: (c) => campaignStatusLabels.label(t, c.status) },
        ]}
      />
    </ListPage>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default CampaignsPage;
