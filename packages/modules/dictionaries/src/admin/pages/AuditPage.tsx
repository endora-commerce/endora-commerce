import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, ClipboardCopy, RefreshCw } from 'lucide-react';
import { ApiError, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, EmptyState, InlineStatus, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { ListPage, ResponsiveTable, type ListPageLoad } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import type { DictionaryOrphanRow } from '@endora-commerce/contracts';
import { dictionaryClient } from '../api/client.js';

const rowKey = (row: DictionaryOrphanRow): string => `${row.dictionary}:${row.tableName}:${row.columnName}:${row.code}`;

/**
 * The orphan-reference audit: every stored code no dictionary entry answers
 * for any more, grouped by where it is stored.
 *
 * The kit's `ListPage` since issue #1749. The report's tools — refresh, copy
 * as CSV, invalidate the cache — are the toolbar row, their results said beside
 * them (`InlineStatus`, DEC-12 a) rather than in a banner; the number of groups
 * is the list's count. The report is computed whole, so there is no pager.
 */
export function DictionaryAuditPage(): ReactNode {
  const t = useTranslation('dictionaries');
  const { language } = useTranslationContext();
  const [rows, setRows] = useState<DictionaryOrphanRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const status = useInlineStatus();
  const { show: showStatus, clear: clearStatus } = status;

  const refresh = useCallback(async (): Promise<void> => {
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    setRefreshing(true);
    try {
      const res = await dictionaryClient.getOrphanAudit();
      setRows(res.data);
      setGeneratedAt(res.meta.generatedAt);
      setLoad({ kind: 'ready' });
    } catch (err) {
      setLoad({ kind: 'error', message: err instanceof ApiError ? err.envelope.error.message : t('audit.error.load') });
    } finally {
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const csv = useMemo(() => toCsv(rows), [rows]);

  const copyCsv = useCallback(async (): Promise<void> => {
    setActionError(null);
    clearStatus();
    try {
      await navigator.clipboard.writeText(csv);
      showStatus(t('audit.info.copied'));
    } catch {
      setActionError(t('audit.error.copy'));
    }
  }, [csv, t, showStatus, clearStatus]);

  const invalidateCache = useCallback(async (): Promise<void> => {
    setActionError(null);
    clearStatus();
    try {
      await dictionaryClient.invalidateCache();
      showStatus(t('audit.info.invalidated'));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.envelope.error.message : t('audit.error.invalidate'));
    }
  }, [t, showStatus, clearStatus]);

  return (
    <ListPage
      title={t('audit.page.title')}
      description={t('audit.page.description')}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing || undefined}>
            <RefreshCw aria-hidden="true" />
            {t('audit.refresh')}
          </Button>
          <Button type="button" variant="outline" onClick={() => void copyCsv()} disabled={rows.length === 0}>
            <ClipboardCopy aria-hidden="true" />
            {t('audit.copyCsv')}
          </Button>
          <Button type="button" variant="outline" onClick={() => void invalidateCache()}>
            <RefreshCw aria-hidden="true" />
            {t('audit.invalidateCache')}
          </Button>
          <InlineStatus {...status.props} />
          {generatedAt ? (
            <span className="text-sm text-muted-foreground">
              {t('audit.generatedAt', { date: formatDateTime(generatedAt, language) })}
            </span>
          ) : null}
        </div>
      }
      count={t('audit.groupCount', { count: rows.length })}
      notice={
        actionError ? (
          <Alert variant="destructive">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null
      }
      load={load}
      onRetry={() => void refresh()}
    >
      <ResponsiveTable
        data={rows}
        keyExtractor={rowKey}
        // Issue #1448 (DS-15): a clean report is the region's whole body, so it is
        // the kit block — not an empty table with one grey row.
        emptyState={<EmptyState icon={<CheckCircle2 size={20} />} title={t('audit.empty')} description={t('audit.emptyBody')} />}
        columns={[
          { id: 'dictionary', header: t('audit.column.dictionary'), primary: true, render: (row) => row.dictionary, meta: (row) => row.consumer },
          { id: 'consumer', header: t('audit.column.consumer'), hideOnMobile: true, render: (row) => row.consumer },
          { id: 'table', header: t('audit.column.table'), render: (row) => row.tableName },
          { id: 'column', header: t('audit.column.column'), render: (row) => row.columnName },
          { id: 'code', header: t('audit.column.code'), render: (row) => <span className="font-mono text-xs">{row.code}</span> },
          { id: 'rows', header: t('audit.column.rows'), className: 'text-right', render: (row) => row.count },
        ]}
      />
    </ListPage>
  );
}

function toCsv(rows: DictionaryOrphanRow[]): string {
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

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default DictionaryAuditPage;
