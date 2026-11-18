import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { EChartsOption } from 'echarts';
import type { CampaignStats as CampaignStatsDto } from '@endora-commerce/contracts';
import { EChart } from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@endora-commerce/admin-kit/ui';
import { newsletterClient } from '../api/newsletter-client.js';

export function CampaignStats(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const t = useTranslation('newsletter');
  const { language } = useTranslationContext();
  const [stats, setStats] = useState<CampaignStatsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    newsletterClient
      .campaignStats(id)
      .then(setStats)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  if (!hasPermission('newsletter:read')) {
    return (
      <Alert>
        <AlertDescription>{t('common.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  const percent = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 });
  const option: EChartsOption | null = stats
    ? {
        tooltip: {},
        xAxis: {
          type: 'category',
          data: [
            t('stats.metric.sent'),
            t('stats.metric.delivered'),
            t('stats.metric.failed'),
            t('stats.metric.opened'),
            t('stats.metric.clicked'),
          ],
        },
        yAxis: { type: 'value' },
        series: [
          {
            type: 'bar',
            data: [stats.sent, stats.delivered, stats.failed, stats.opened, stats.clicked],
          },
        ],
      }
    : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('stats.title')}
        back={{ label: t('campaign.back'), to: '/newsletter/campaigns' }}
        description={
          stats
            ? t('stats.rates', { open: percent.format(stats.openRate), click: percent.format(stats.clickRate) })
            : undefined
        }
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {option ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('stats.engagement')}</CardTitle>
          </CardHeader>
          <CardContent>
            <EChart option={option} className="h-80 w-full" />
          </CardContent>
        </Card>
      ) : null}
      {stats && stats.perLinkClicks.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('stats.links.title')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="p-3 font-medium">{t('stats.links.url')}</th>
                  <th className="p-3 font-medium">{t('stats.links.clicks')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.perLinkClicks.map((l) => (
                  <tr key={l.url} className="border-b last:border-0">
                    <td className="p-3 font-mono text-xs">{l.url}</td>
                    <td className="p-3">{l.clicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default CampaignStats;
