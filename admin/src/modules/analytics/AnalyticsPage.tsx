import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import type { AnalyticsSummaryResponse } from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';

const RANGE_OPTION_VALUES = [7, 30, 90] as const;

interface SummaryEnvelope {
  data: AnalyticsSummaryResponse;
}

export function AnalyticsPage(): ReactNode {
  const t = useTranslation('core');
  const RANGE_OPTIONS = [
    { value: 7, label: t('analytics.range.7days') },
    { value: 30, label: t('analytics.range.30days') },
    { value: 90, label: t('analytics.range.90days') },
  ];
  void RANGE_OPTION_VALUES;
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [summary, setSummary] = useState<AnalyticsSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const window = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - rangeDays * 24 * 60 * 60 * 1000);
    return { fromIso: from.toISOString(), toIso: to.toISOString() };
  }, [rangeDays]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const qs = `?from=${encodeURIComponent(window.fromIso)}&to=${encodeURIComponent(window.toIso)}`;
      const res = await apiClient.get<SummaryEnvelope>(`/api/v1/admin/analytics/summary${qs}`);
      setSummary(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('analytics.error.load'));
    } finally {
      setLoading(false);
    }
  }, [window.fromIso, window.toIso, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dailyByDay = useMemo(() => groupDailyByDay(summary?.daily ?? []), [summary]);
  const allTypes = useMemo(
    () => Array.from(new Set((summary?.daily ?? []).map((d) => d.type))).sort(),
    [summary],
  );

  return (
    <>
      <PageHeader
        title={t('analytics.page.title')}
        description={
          <>
            {t('analytics.page.descriptionPrefix')} {formatDateTime(window.fromIso)} –{' '}
            {formatDateTime(window.toIso)}.
          </>
        }
        actions={
          <>
            <Select
              className="w-auto"
              value={rangeDays}
              onChange={(e): void => setRangeDays(Number(e.target.value))}
            >
              {RANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={(): void => {
                void refresh();
              }}
            >
              <RefreshCw />
              {t('analytics.refresh')}
            </Button>
          </>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('analytics.totals.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('analytics.loading')}</p>
          ) : !summary || summary.totalsByType.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('analytics.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('analytics.column.eventType')}</TableHead>
                  <TableHead className="text-right">{t('analytics.column.count')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.totalsByType.map((row) => (
                  <TableRow key={row.type}>
                    <TableCell className="font-mono text-xs">{row.type}</TableCell>
                    <TableCell className="text-right">{row.count.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('analytics.daily.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('analytics.loading')}</p>
          ) : dailyByDay.size === 0 ? (
            <p className="text-sm text-muted-foreground">{t('analytics.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('analytics.column.day')}</TableHead>
                  {allTypes.map((type) => (
                    <TableHead key={type} className="text-right font-mono text-xs">
                      {type}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(dailyByDay.entries()).map(([day, counts]) => (
                  <TableRow key={day}>
                    <TableCell>{day}</TableCell>
                    {allTypes.map((type) => (
                      <TableCell key={type} className="text-right">
                        {(counts[type] ?? 0).toLocaleString()}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function groupDailyByDay(
  rows: AnalyticsSummaryResponse['daily'],
): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const bucket = out.get(row.day) ?? {};
    bucket[row.type] = row.count;
    out.set(row.day, bucket);
  }
  return out;
}
