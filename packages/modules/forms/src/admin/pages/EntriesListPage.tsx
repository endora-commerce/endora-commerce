import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Download, Inbox, SearchX, Trash2 } from 'lucide-react';
import type { FormEntrySummary, FormSummary } from '@endora-commerce/contracts';
import { ModalDialog, ResponsiveTable, type ResponsiveColumn } from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, Checkbox, PageHeader } from '@endora-commerce/admin-kit/ui';
import { entriesApi, formsApi, type EntryFilterParams } from '../api.js';
import {
  EntryFilters,
  EntryStatusBadge,
  NO_ENTRY_FILTERS,
  endOfDay,
  isFiltered,
  startOfDay,
  type EntryFilterValues,
} from '../components/EntryFilters.js';
import { errorMessage } from '../lib/errors.js';

const PAGE_SIZE = 50;

type Load =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: FormEntrySummary[]; nextCursor: string | null; loadingMore: boolean };

function paramsOf(values: EntryFilterValues): EntryFilterParams {
  return {
    formId: values.formId || undefined,
    status: values.statuses.length > 0 ? values.statuses : undefined,
    submittedFrom: startOfDay(values.from),
    submittedTo: endOfDay(values.to),
    salesChannelId: values.salesChannelId ?? undefined,
    q: values.q.trim() || undefined,
  };
}

/**
 * The entries list (`specs/170-forms-module/` User Story 4, contracts/admin-surfaces.md §4): every
 * entry the reader's scope holds, newest first, filtered by form, statuses, a date range, channel
 * and a search (FR-050), older ones a step away by the keyset the API pages with. A holder of
 * `forms:entries_write` selects entries and deletes them behind a dialog that says it is for good
 * (US4-7); a holder of `forms:entries_export` downloads the chosen form's entries as CSV (FR-052).
 *
 * The scope is the server's: an administrator confined to some organisations simply sees fewer
 * entries, and never an anonymous one (FR-046).
 */
export function EntriesListPage(): ReactNode {
  const t = useTranslation('forms');
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('forms:entries_write');
  const canExport = hasPermission('forms:entries_export');
  const id = useId();
  const [filters, setFilters] = useState<EntryFilterValues>(NO_ENTRY_FILTERS);
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    formsApi
      .list({ pageSize: 100 })
      .then((result) => {
        if (alive) setForms(result.items);
      })
      // Without `forms:read` the form filter offers "All forms" only; the list still works.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(() => {
    let alive = true;
    setSelected(new Set());
    entriesApi
      .list({ ...paramsOf(filters), limit: PAGE_SIZE })
      .then((page) => {
        if (alive) setLoad({ kind: 'ready', items: page.items, nextCursor: page.nextCursor, loadingMore: false });
      })
      .catch(() => {
        if (alive) setLoad({ kind: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [filters]);

  useEffect(() => reload(), [reload]);

  const loadMore = async (): Promise<void> => {
    if (load.kind !== 'ready' || !load.nextCursor) return;
    setLoad({ ...load, loadingMore: true });
    try {
      const page = await entriesApi.list({ ...paramsOf(filters), limit: PAGE_SIZE, cursor: load.nextCursor });
      setLoad({ kind: 'ready', items: [...load.items, ...page.items], nextCursor: page.nextCursor, loadingMore: false });
    } catch (failure) {
      setLoad({ ...load, loadingMore: false });
      setActionError(errorMessage(failure, t('entries.loadError')));
    }
  };

  const removeSelected = async (): Promise<void> => {
    setDeleting(true);
    setActionError(null);
    try {
      await entriesApi.removeMany([...selected]);
      setConfirmDelete(false);
      reload();
    } catch (failure) {
      setActionError(errorMessage(failure, t('entries.actionError')));
    } finally {
      setDeleting(false);
    }
  };

  const sent = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
  const items = load.kind === 'ready' ? load.items : [];
  const allSelected = items.length > 0 && items.every((entry) => selected.has(entry.id));
  const toggle = (id: string, on: boolean): void =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const columns: ResponsiveColumn<FormEntrySummary>[] = [
    ...(canWrite
      ? [
          {
            id: 'select',
            header: <span className="sr-only">{t('entries.column.select')}</span>,
            render: (entry: FormEntrySummary) => (
              <Checkbox
                aria-label={t('entries.select', { date: sent.format(new Date(entry.submittedAt)) })}
                checked={selected.has(entry.id)}
                onChange={(event) => toggle(entry.id, event.target.checked)}
              />
            ),
          },
        ]
      : []),
    {
      id: 'from',
      header: t('entries.column.from'),
      primary: true,
      render: (entry) => (
        <Link to={`/forms/entries/${entry.id}`} className="font-medium text-primary hover:underline">
          {entry.submitterEmail ?? t('entries.anonymous')}
        </Link>
      ),
      meta: (entry) => sent.format(new Date(entry.submittedAt)),
    },
    { id: 'form', header: t('entries.column.form'), render: (entry) => entry.formName },
    {
      id: 'submitted',
      header: t('entries.column.submitted'),
      hideOnMobile: true,
      render: (entry) => <time dateTime={entry.submittedAt}>{sent.format(new Date(entry.submittedAt))}</time>,
    },
    { id: 'status', header: t('entries.column.status'), render: (entry) => <EntryStatusBadge status={entry.status} /> },
  ];

  const exportControl = canExport ? (
    filters.formId ? (
      <Button asChild variant="outline">
        <a href={entriesApi.exportUrl({ ...paramsOf(filters), formId: filters.formId })} download>
          <Download size={16} aria-hidden="true" />
          {t('entries.export')}
        </a>
      </Button>
    ) : (
      <div className="flex items-center gap-2">
        <span id={`${id}-export-hint`} className="text-xs text-muted-foreground">
          {t('entries.exportHint')}
        </span>
        <Button type="button" variant="outline" disabled aria-describedby={`${id}-export-hint`}>
          <Download size={16} aria-hidden="true" />
          {t('entries.export')}
        </Button>
      </div>
    )
  ) : null;

  return (
    <div className="space-y-4">
      <PageHeader title={t('entries.title')} description={t('entries.description')} actions={exportControl} />
      <Card>
        <CardHeader className="border-b border-border p-4">
          <EntryFilters values={filters} forms={forms} onChange={setFilters} />
        </CardHeader>
        <CardContent className="space-y-4 p-4" aria-busy={load.kind === 'loading' || undefined}>
          {actionError ? (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
          {load.kind === 'loading' ? <p className="py-6 text-center text-sm text-muted-foreground">{t('entries.loading')}</p> : null}
          {load.kind === 'error' ? (
            <Alert variant="destructive">
              <AlertDescription>{t('entries.loadError')}</AlertDescription>
            </Alert>
          ) : null}
          {load.kind === 'ready' ? (
            <>
              {canWrite && items.length > 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`${id}-select-all`}
                      checked={allSelected}
                      onChange={(event) => setSelected(event.target.checked ? new Set(items.map((entry) => entry.id)) : new Set())}
                    />
                    <label htmlFor={`${id}-select-all`} className="text-sm">
                      {t('entries.selectAll')}
                    </label>
                  </div>
                  {selected.size > 0 ? (
                    <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                      <Trash2 size={14} aria-hidden="true" />
                      {t('entries.deleteSelected', { count: selected.size })}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <ResponsiveTable
                columns={columns}
                data={load.items}
                keyExtractor={(entry) => entry.id}
                emptyState={
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    {isFiltered(filters) ? (
                      <SearchX size={32} aria-hidden="true" className="text-muted-foreground" />
                    ) : (
                      <Inbox size={32} aria-hidden="true" className="text-muted-foreground" />
                    )}
                    <p className="text-sm text-muted-foreground">
                      {isFiltered(filters) ? t('entries.emptyFiltered') : t('entries.empty')}
                    </p>
                    {isFiltered(filters) ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => setFilters(NO_ENTRY_FILTERS)}>
                        {t('entries.clearFilters')}
                      </Button>
                    ) : null}
                  </div>
                }
              />
              {load.nextCursor ? (
                <div className="flex justify-center">
                  <Button type="button" variant="outline" disabled={load.loadingMore} onClick={() => void loadMore()}>
                    {t('entries.loadMore')}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
      {confirmDelete ? (
        <ModalDialog
          title={t('entries.deleteDialog.title', { count: selected.size })}
          onClose={() => setConfirmDelete(false)}
          busy={deleting}
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                {t('entries.deleteDialog.cancel')}
              </Button>
              <Button type="button" variant="destructive" onClick={() => void removeSelected()} disabled={deleting}>
                {t('entries.deleteDialog.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('entries.deleteDialog.body')}</p>
        </ModalDialog>
      ) : null}
    </div>
  );
}

export default EntriesListPage;
