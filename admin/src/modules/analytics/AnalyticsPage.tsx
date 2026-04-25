import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AnalyticsSummaryResponse } from '@b2b/contracts';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

const RANGE_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
] as const;

interface SummaryEnvelope {
  data: AnalyticsSummaryResponse;
}

export function AnalyticsPage(): ReactNode {
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
      const res = await apiClient.get<SummaryEnvelope>(
        `/api/v1/admin/analytics/summary${qs}`,
      );
      setSummary(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load summary.');
    } finally {
      setLoading(false);
    }
  }, [window.fromIso, window.toIso]);

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
      <header className="page-header">
        <div>
          <h1>Analytics</h1>
          <p>
            Aggregated counts of storefront events. Window:{' '}
            <span className="muted">
              {formatDateTime(window.fromIso)} – {formatDateTime(window.toIso)}
            </span>
            .
          </p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <select
            className="select"
            style={{ width: 'auto' }}
            value={rangeDays}
            onChange={(e): void => setRangeDays(Number(e.target.value))}
          >
            {RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            className="btn"
            onClick={(): void => {
              void refresh();
            }}
          >
            Refresh
          </button>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Totals by event type</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : !summary || summary.totalsByType.length === 0 ? (
          <p className="muted">No events recorded in this window.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Event type</th>
                <th style={{ textAlign: 'right' }}>Count</th>
              </tr>
            </thead>
            <tbody>
              {summary.totalsByType.map((row) => (
                <tr key={row.type}>
                  <td className="code">{row.type}</td>
                  <td style={{ textAlign: 'right' }}>{row.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Daily breakdown</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : dailyByDay.size === 0 ? (
          <p className="muted">No events recorded in this window.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Day</th>
                {allTypes.map((t) => (
                  <th key={t} className="code" style={{ textAlign: 'right' }}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(dailyByDay.entries()).map(([day, counts]) => (
                <tr key={day}>
                  <td>{day}</td>
                  {allTypes.map((t) => (
                    <td key={t} style={{ textAlign: 'right' }}>
                      {(counts[t] ?? 0).toLocaleString()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
