import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, Plus } from 'lucide-react';
import { FORM_STATUSES, type FormStatus, type FormSummary } from '@endora-commerce/contracts';
import {
  ListPage,
  ListToolbar,
  ListToolbarSearch,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  useListPagination,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, EmptyState, Select } from '@endora-commerce/admin-kit/ui';
import { formsApi } from '../api.js';
import { DeleteFormDialog, FormStatusBadge, FormWarningList } from '../components/FormStatus.js';
import { errorMessage } from '../lib/errors.js';

/** The largest page the forms list endpoint serves (`formListQuerySchema`). */
const MAX_PAGE_SIZE = 100;

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; items: FormSummary[]; total: number };

/**
 * The forms list (`specs/170-forms-module/` User Story 1, contracts/admin-surfaces.md §4): every
 * form with its key, status, published version, entries and warnings, newest change first, filtered
 * by text and status. The row actions — open, duplicate, close or reopen, delete — are offered to a
 * holder of `forms:write`; each write names the revision it read (R-26), so the row's form is read
 * fresh before it is changed.
 *
 * The kit's list page (issues #1439 DS-05, #1440 DS-06): the search and the status filter are a
 * toolbar row above the results, not a card header, and the pager is the kit's, remembering the
 * administrator's page size.
 */
export function FormsListPage(): ReactNode {
  const t = useTranslation('forms');
  const { language } = useAppLanguage();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('forms:write');
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<FormStatus | ''>('');
  const pagination = useListPagination({ scope: 'forms', maxPageSize: MAX_PAGE_SIZE });
  const { page, pageSize } = pagination.query;
  const { resetPage, syncTotal } = pagination;
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ form: FormSummary; revision: number } | null>(null);

  const reload = useCallback(() => {
    let alive = true;
    formsApi
      .list({ q: q.trim() || undefined, status: status || undefined, page, pageSize })
      .then((result) => {
        if (!alive) return;
        setLoad({ kind: 'ready', items: result.items, total: result.total });
        syncTotal(result.total);
      })
      .catch(() => {
        if (alive) setLoad({ kind: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [q, status, page, pageSize, syncTotal]);

  useEffect(() => reload(), [reload]);

  const act = async (form: FormSummary, action: 'duplicate' | 'close' | 'reopen' | 'delete'): Promise<void> => {
    setActionError(null);
    try {
      if (action === 'duplicate') {
        const copy = await formsApi.duplicate(form.id);
        navigate(`/forms/${copy.id}`);
        return;
      }
      const current = await formsApi.get(form.id);
      if (action === 'delete') {
        setDeleting({ form: { ...form, entryCount: current.entryCount }, revision: current.revision });
        return;
      }
      await (action === 'close' ? formsApi.close(form.id, current.revision) : formsApi.reopen(form.id, current.revision));
      reload();
    } catch (failure) {
      setActionError(errorMessage(failure, t('list.actionError')));
    }
  };

  const updated = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
  const columns: ResponsiveColumn<FormSummary>[] = [
    {
      id: 'name',
      header: t('list.column.name'),
      primary: true,
      render: (form) => (
        <Link to={`/forms/${form.id}`} className="font-medium text-primary hover:underline">
          {form.name}
        </Link>
      ),
      meta: (form) => <code className="text-xs">{form.key}</code>,
    },
    { id: 'key', header: t('list.column.key'), hideOnMobile: true, render: (form) => <code className="text-xs">{form.key}</code> },
    { id: 'status', header: t('list.column.status'), render: (form) => <FormStatusBadge status={form.status} /> },
    {
      id: 'version',
      header: t('list.column.version'),
      render: (form) =>
        form.publishedVersionNumber > 0 ? t('list.version', { number: form.publishedVersionNumber }) : t('list.notPublished'),
    },
    { id: 'entries', header: t('list.column.entries'), className: 'text-right', render: (form) => String(form.entryCount) },
    { id: 'updated', header: t('list.column.updated'), hideOnMobile: true, render: (form) => updated.format(new Date(form.updatedAt)) },
    { id: 'warnings', header: t('list.column.warnings'), render: (form) => <FormWarningList warnings={form.warnings} compact /> },
  ];

  const filtered = q.trim() !== '' || status !== '';
  const clearFilters = (): void => {
    setQ('');
    setStatus('');
    resetPage();
  };
  const createLink = (
    <Button asChild className="min-h-11 sm:min-h-9">
      <Link to="/forms/new">
        <Plus size={16} aria-hidden="true" />
        {t('list.create')}
      </Link>
    </Button>
  );
  // With no form at all the empty state carries the one create action; a second
  // filled button for the same thing in the header would compete (Von Restorff).
  const nothingYet = load.kind === 'ready' && load.total === 0 && !filtered;
  const listLoad: ListPageLoad =
    load.kind === 'error' ? { kind: 'error', message: t('list.loadError') } : { kind: load.kind };
  return (
    <>
      <ListPage
        title={t('list.title')}
        actions={canWrite && !nothingYet ? createLink : null}
        toolbar={
          <ListToolbar
            className="min-w-0 flex-1"
            label={t('list.toolbar')}
            search={
              <ListToolbarSearch
                ref={searchRef}
                label={t('list.search')}
                placeholder={t('list.search')}
                value={q}
                onValueChange={(next) => {
                  setQ(next);
                  resetPage();
                }}
              />
            }
            filters={
              <Select
                aria-label={t('list.status')}
                className="w-auto"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as FormStatus | '');
                  resetPage();
                }}
              >
                <option value="">{t('list.allStatuses')}</option>
                {FORM_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`status.${value}`)}
                  </option>
                ))}
              </Select>
            }
            filtersActive={filtered}
            onClearFilters={clearFilters}
          />
        }
        count={load.kind === 'ready' ? t('list.count', { count: load.total }) : null}
        notice={
          actionError ? (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null
        }
        load={listLoad}
        onRetry={reload}
        pagination={load.kind === 'ready' ? pagination.footer(load.total) : null}
      >
        <ResponsiveTable
          columns={columns}
          data={load.kind === 'ready' ? load.items : []}
          keyExtractor={(form) => form.id}
          emptyState={
            filtered ? (
              <EmptyState
                variant="no-results"
                title={t('list.emptyFiltered')}
                onClearFilters={clearFilters}
                focusAfterClear={searchRef}
              />
            ) : (
              <EmptyState
                icon={<ClipboardList size={20} />}
                title={t('list.empty.title')}
                description={canWrite ? t('list.empty.body') : t('list.empty.bodyReadOnly')}
                action={canWrite ? createLink : null}
              />
            )
          }
          {...(canWrite
            ? {
                renderActions: (form: FormSummary) => (
                  <RowActionMenu label={t('list.actions', { name: form.name })}>
                    <RowActionMenuItem onSelect={() => { navigate(`/forms/${form.id}`); }}>{t('list.open')}</RowActionMenuItem>
                    <RowActionMenuItem onSelect={() => void act(form, 'duplicate')}>{t('list.duplicate')}</RowActionMenuItem>
                    {form.status === 'published' ? (
                      <RowActionMenuItem onSelect={() => void act(form, 'close')}>{t('list.close')}</RowActionMenuItem>
                    ) : null}
                    {form.status === 'closed' ? (
                      <RowActionMenuItem onSelect={() => void act(form, 'reopen')}>{t('list.reopen')}</RowActionMenuItem>
                    ) : null}
                    <RowActionMenuSeparator />
                    <RowActionMenuItem destructive onSelect={() => void act(form, 'delete')}>
                      {t('list.delete')}
                    </RowActionMenuItem>
                  </RowActionMenu>
                ),
              }
            : {})}
        />
      </ListPage>
      {deleting ? (
        <DeleteFormDialog
          name={deleting.form.name}
          entryCount={deleting.form.entryCount}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await formsApi.remove(deleting.form.id, deleting.revision, deleting.form.entryCount > 0);
            setDeleting(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

export default FormsListPage;
