import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CampaignSummary } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Card, CardContent, PageHeader } from '@endora-commerce/admin-kit/ui';
import { newsletterClient } from '../api/newsletter-client.js';
import { campaignStatusLabels, campaignTargetLabels } from '../lib/labels.js';

export function CampaignsPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const t = useTranslation('newsletter');
  const [items, setItems] = useState<CampaignSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    newsletterClient
      .listCampaigns()
      .then((res) => setItems(res.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (!hasPermission('newsletter:read')) {
    return (
      <Alert>
        <AlertDescription>{t('common.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('campaigns.title')}
        actions={
          hasPermission('newsletter:write') ? (
            <Button asChild>
              <Link to="/newsletter/campaigns/new">{t('campaigns.new')}</Link>
            </Button>
          ) : null
        }
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">{t('common.column.name')}</th>
                <th className="p-3 font-medium">{t('campaigns.column.subject')}</th>
                <th className="p-3 font-medium">{t('campaigns.column.audience')}</th>
                <th className="p-3 font-medium">{t('common.column.status')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-3">
                    <Link className="font-medium text-primary hover:underline" to={`/newsletter/campaigns/${c.id}`}>
                      {c.name}
                    </Link>
                  </td>
                  <td className="p-3">{c.subject}</td>
                  <td className="p-3">{campaignTargetLabels.label(t, c.targetType)}</td>
                  <td className="p-3">{campaignStatusLabels.label(t, c.status)}</td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={4}>
                    {t('campaigns.empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default CampaignsPage;
