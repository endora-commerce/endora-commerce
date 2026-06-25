import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Download, Settings } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { returnsClient } from './api/returns-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { useTranslation } from '@/i18n/useTranslation';
import type { AdminReturnRow } from '@b2b/contracts';

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? 'http://localhost:3001';

/** Returns / RMA admin list (feature 046, US8). */
export function ReturnsList(): ReactNode {
  const t = useTranslation('core');
  const [rows, setRows] = useState<AdminReturnRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [rma, setRma] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set('status', statusFilter);
    if (kindFilter) p.set('kind', kindFilter);
    if (rma.trim()) p.set('rmaNumber', rma.trim());
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [statusFilter, kindFilter, rma]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await returnsClient.list(queryString);
      setRows(res.rows);
      setCounts(res.counts);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load returns.');
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkAuthorize = useCallback(async (): Promise<void> => {
    setError(null);
    setInfo(null);
    try {
      const res = await returnsClient.bulkTransition([...selected], 'authorized');
      setInfo(`Authorized ${res.moved.length}, skipped ${res.skipped.length}.`);
      setSelected(new Set());
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Bulk action failed.');
    }
  }, [selected, refresh]);

  return (
    <div className="space-y-4">
      <PageHeader title={t('returns.title')} description={t('returns.description')} />

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {Object.entries(counts).map(([code, n]) => (
          <Badge key={code} variant="secondary">
            {code}: {n}
          </Badge>
        ))}
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/returns/statuses">
              <Settings className="size-4" /> {t('returns.nav.workflow')}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/returns/reasons">{t('returns.nav.reasons')}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/returns/delivery-methods">{t('returns.nav.returnMethods')}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={`${API_BASE}/api/v1/admin/returns/export${queryString}`}>
              <Download className="size-4" /> {t('returns.nav.csv')}
            </a>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1">
            <Label htmlFor="kind">{t('returns.filter.kind')}</Label>
            <Select id="kind" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
              <option value="">{t('returns.filter.all')}</option>
              <option value="return">{t('returns.kind.return')}</option>
              <option value="complaint">{t('returns.kind.complaint')}</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="status">{t('returns.filter.status')}</Label>
            <Select id="status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t('returns.filter.all')}</option>
              {Object.keys(counts).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rma">{t('returns.filter.rmaNumber')}</Label>
            <input
              id="rma"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={rma}
              onChange={(e) => setRma(e.target.value)}
              placeholder="RMA-…"
            />
          </div>
          {selected.size > 0 && (
            <Button size="sm" onClick={() => void bulkAuthorize()}>
              {t('returns.bulk.authorize', { count: selected.size })}
            </Button>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info && (
        <Alert>
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>{t('returns.col.rma')}</TableHead>
                <TableHead>{t('returns.col.kind')}</TableHead>
                <TableHead>{t('returns.col.status')}</TableHead>
                <TableHead>{t('returns.col.refund')}</TableHead>
                <TableHead>{t('returns.col.submitted')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.rmaNumber ?? '—'}</TableCell>
                  <TableCell>{r.kind}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.statusLabel}</Badge>
                  </TableCell>
                  <TableCell>
                    {r.totalRefundAmount.toFixed(2)} {r.currency}
                  </TableCell>
                  <TableCell>{formatDateTime(r.submittedAt)}</TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/returns/${r.id}`}>{t('returns.action.open')}</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {t('returns.empty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
