import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ClipboardCopy, RefreshCw } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { dictionaryClient, type DictionaryAuditRow } from './client';

export function DictionaryAuditPage(): ReactNode {
  const [rows, setRows] = useState<DictionaryAuditRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await dictionaryClient.getOrphanAudit();
      setRows(res.data);
      setGeneratedAt(res.meta.generatedAt);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load audit report.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const csv = useMemo(() => toCsv(rows), [rows]);

  const copyCsv = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(csv);
      setInfo('Copied audit report as CSV.');
    } catch {
      setError('Could not copy CSV to clipboard.');
    }
  }, [csv]);

  const invalidateCache = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      await dictionaryClient.invalidateCache();
      setInfo('Dictionary cache invalidated.');
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Cache invalidation failed.');
    }
  }, []);

  return (
    <>
      <PageHeader
        title="Dictionary audit"
        description="Unresolved country, currency, and language references across platform consumers."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw />
          Refresh
        </Button>
        <Button type="button" variant="outline" onClick={() => void copyCsv()} disabled={rows.length === 0}>
          <ClipboardCopy />
          Copy CSV
        </Button>
        <Button type="button" variant="outline" onClick={() => void invalidateCache()}>
          <RefreshCw />
          Invalidate cache
        </Button>
        {generatedAt ? (
          <span className="text-sm text-muted-foreground">
            Generated {new Date(generatedAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Orphan references</CardTitle>
          <Badge variant={rows.length === 0 ? 'outline' : 'destructive'}>
            {loading ? 'Loading' : `${rows.length} groups`}
          </Badge>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dictionary</TableHead>
                <TableHead>Consumer</TableHead>
                <TableHead>Table</TableHead>
                <TableHead>Column</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="text-right">Rows</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    {loading ? 'Loading audit report.' : 'No unresolved references found.'}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={`${row.dictionary}:${row.tableName}:${row.columnName}:${row.code}`}>
                    <TableCell>{row.dictionary}</TableCell>
                    <TableCell>{row.consumer}</TableCell>
                    <TableCell>{row.tableName}</TableCell>
                    <TableCell>{row.columnName}</TableCell>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function toCsv(rows: DictionaryAuditRow[]): string {
  const header = ['dictionary', 'consumer', 'tableName', 'columnName', 'code', 'count'];
  return [
    header.join(','),
    ...rows.map((row) =>
      [
        row.dictionary,
        row.consumer,
        row.tableName,
        row.columnName,
        row.code,
        String(row.count),
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\n');
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
