import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, Plus, SearchX } from 'lucide-react';
import { FORM_STATUSES, type FormStatus, type FormSummary } from '@endora-commerce/contracts';
import {
  PaginationFooter,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, Input, Label, PageHeader, Select } from '@endora-commerce/admin-kit/ui';
import { formsApi } from '../api.js';
import { DeleteFormDialog, FormStatusBadge, FormWarningList } from '../components/FormStatus.js';
import { errorMessage } from '../lib/errors.js';

const PAGE_SIZES = [10, 20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZES)[number];

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; items: FormSummary[]; total: number };

/**
 * The forms list (`specs/170-forms-module/` User Story 1, contracts/admin-surfaces.md §4): every
 * form with its key, status, published version, entries and warnings, newest change first, filtered
 * by text and status. The row actions — open, duplicate, close or reopen, delete — are offered to a
 * holder of `forms:write`; each write names the revision it read (R-26), so the row's form is read
 * fresh before it is changed.
 */
export function FormsListPage(): ReactNode {
  const t = useTranslation('forms');
  const { language } = useAppLanguage();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('forms:write');
  const searchId = useId();
  const statusId = useId();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<FormStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ form: FormSummary; revision: number } | null>(null);

  const reload = useCallback(() => {
    let alive = true;
    formsApi
      .list({ q: q.trim() || undefined, status: status || undefined, page, pageSize })
      .then((result) => {
        if (alive) setLoad({ kind: 'ready', items: result.items, total: result.total });
      })
      .catch(() => {
        if (alive) setLoad({ kind: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [q, status, page, pageSize]);

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
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        actions={
          canWrite ? (
            <Button asChild>
              <Link to="/forms/new">
                <Plus size={16} aria-hidden="true" />
                {t('list.create')}
              </Link>
            </Button>
          ) : null
        }
      />
      <Card>
        <CardHeader className="border-b border-border p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor={searchId}>{t('list.search')}</Label>
              <Input
                id={searchId}
                type="search"
                value={q}
                onChange={(event) => {
                  setQ(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={statusId}>{t('list.status')}</Label>
              <Select
                id={statusId}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as FormStatus | '');
                  setPage(1);
                }}
              >
                <option value="">{t('list.allStatuses')}</option>
                {FORM_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`status.${value}`)}
                  </option>
                ))}
              </Select>
            </div>
            <p aria-live="polite" className="ml-auto self-center text-sm text-muted-foreground">
              {load.kind === 'ready' ? t('list.count', { count: load.total }) : ''}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4" aria-busy={load.kind === 'loading' || undefined}>
          {actionError ? (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
          {load.kind === 'loading' ? <p className="py-6 text-center text-sm text-muted-foreground">{t('list.loading')}</p> : null}
          {load.kind === 'error' ? (
            <Alert variant="destructive">
              <AlertDescription>{t('list.loadError')}</AlertDescription>
            </Alert>
          ) : null}
          {load.kind === 'ready' ? (
            <>
              <ResponsiveTable
                columns={columns}
                data={load.items}
                keyExtractor={(form) => form.id}
                emptyState={
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    {filtered ? (
                      <SearchX size={32} aria-hidden="true" className="text-muted-foreground" />
                    ) : (
                      <ClipboardList size={32} aria-hidden="true" className="text-muted-foreground" />
                    )}
                    <p className="text-sm text-muted-foreground">{filtered ? t('list.emptyFiltered') : t('list.empty')}</p>
                    {filtered ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setQ('');
                          setStatus('');
                          setPage(1);
                        }}
                      >
                        {t('list.clearFilters')}
                      </Button>
                    ) : canWrite ? (
                      <Button asChild size="sm">
                        <Link to="/forms/new">
                          <Plus size={14} aria-hidden="true" />
                          {t('list.create')}
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                }
                {...(canWrite
                  ? {
                      renderActions: (form: FormSummary) => (
                        <RowActionMenu label={t('list.actions', { name: form.name })}>
                          <RowActionMenuItem onSelect={() => navigate(`/forms/${form.id}`)}>{t('list.open')}</RowActionMenuItem>
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
              {load.total > 0 ? (
                <PaginationFooter<PageSize>
                  page={page - 1}
                  pageSize={pageSize}
                  total={load.total}
                  pageSizes={PAGE_SIZES}
                  onPageSizeChange={(next) => {
                    setPageSize(next);
                    setPage(1);
                  }}
                  onPrev={() => setPage((current) => Math.max(1, current - 1))}
                  onNext={() => setPage((current) => current + 1)}
                />
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
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
    </div>
  );
}

export default FormsListPage;
