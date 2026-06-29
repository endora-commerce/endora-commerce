import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { EChartsOption } from 'echarts';
import type { CampaignStats as CampaignStatsDto } from '@b2b/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EChart } from '@/components/charts/echart';
import { useAuth } from '@/lib/auth';
import { newsletterClient } from '../api/newsletter-client';

export function CampaignStats(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
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
        <AlertDescription>You do not have permission to view the newsletter.</AlertDescription>
      </Alert>
    );
  }

  const option: EChartsOption | null = stats
    ? {
        tooltip: {},
        xAxis: { type: 'category', data: ['Sent', 'Delivered', 'Failed', 'Opened', 'Clicked'] },
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
        title="Campaign statistics"
        back={{ label: 'Campaigns', to: '/newsletter/campaigns' }}
        description={stats ? `Open rate ${(stats.openRate * 100).toFixed(1)}% · Click rate ${(stats.clickRate * 100).toFixed(1)}%` : undefined}
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {option ? (
        <Card>
          <CardHeader>
            <CardTitle>Engagement</CardTitle>
          </CardHeader>
          <CardContent>
            <EChart option={option} className="h-80 w-full" />
          </CardContent>
        </Card>
      ) : null}
      {stats && stats.perLinkClicks.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Clicks by link</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="p-3 font-medium">URL</th>
                  <th className="p-3 font-medium">Clicks</th>
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
