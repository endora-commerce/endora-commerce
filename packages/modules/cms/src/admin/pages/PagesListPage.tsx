import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Plus } from 'lucide-react';
import type { CmsPageStatus, CmsPageSummary } from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  EmptyState,
  InlineStatus,
  Select,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  ListToolbar,
  ListToolbarSearch,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  useConfirmDialog,
  useDebouncedValue,
  useRemovalFocus,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cmsClient } from '../api/cms-client.js';
import { cmsDeleteErrorMessage, loadErrorMessage } from '../components/list-delete-error.js';
import { useDuplicateAction } from '../components/duplicate-record.js';

const PAGE_STATUSES: readonly CmsPageStatus[] = ['draft', 'published', 'archived'];

const STATUS_VARIANT: Record<CmsPageStatus, 'success' | 'secondary' | 'outline'> = {
  published: 'success',
  draft: 'secondary',
  archived: 'outline',
};

const rowId = (row: { id: string }): string => row.id;

/**
 * The CMS page list — the kit's `ListPage` (issue #1495, UX audit CONTENT-13):
 * one heading, a search that runs as the operator types and a status filter,
 * statuses as badges with text, and a row menu that opens a page or deletes it
 * through the confirmation and `DELETE /api/v1/admin/cms/pages/:id`. The
 * endpoint answers the whole list, so there is no pager. Duplicate (DEC-17)
 * makes a draft copy under a `-copy` slug and opens it.
 *
 * Archive / Unarchive sit before Delete. Archiving is reversible and the page
 * editor does it without asking, so the menu does too: the row's badge changes
 * in place, the result is said beside "New page" (DEC-12 a) and focus stays on
 * the row's menu trigger; a row the status filter no longer matches leaves the
 * list, and focus moves to its neighbour.
 */
export function PagesListPage(): ReactNode {
  const t = useTranslation('cms');
  const { hasPermission } = useAuth();
  // The create route this screen links to takes the **write** code (feature
  // 091, batch 16), so the button is gated on the same one: a link whose
  // destination the operator's codes cannot open answers the admin's not-found
  // page, which says nothing about permissions at all. The row actions write,
  // so they take it too.
  const canWrite = hasPermission('cms.write');
  const { confirm, confirmDialog } = useConfirmDialog();
  const searchRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CmsPageSummary[]>([]);
  const [q, setQ] = useState('');
  const query = useDebouncedValue(q.trim());
  const [status, setStatus] = useState<CmsPageStatus | ''>('');
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // After a delete, focus goes to the next row, or to "New …" once the list is empty (WCAG 2.4.3).
  const removalFocus = useRemovalFocus(rows, rowId, load.kind === 'ready');
  // Issue #1495 (DEC-17) — Duplicate opens the copy's editor, or keeps the list with the reason.
  const copier = useDuplicateAction<CmsPageSummary>({
    run: (page, body) => cmsClient.duplicatePage(page.id, body),
    editorPath: (id) => `/cms/pages/${id}`,
    t,
  });
  // The result of Archive / Unarchive, in a region mounted before it has text (SC 4.1.3).
  const archiveStatus = useInlineStatus();
  const [archivingId, setArchivingId] = useState<string | null>(null);

  useEffect(() => {
    // A response that lands after a newer request was sent is dropped, so a
    // slow search cannot overwrite the one the operator is looking at now.
    let alive = true;
    setLoad({ kind: 'loading' });
    cmsClient
      .listPages({ ...(query ? { q: query } : {}), ...(status ? { status } : {}) })
      .then((out) => {
        if (!alive) return;
        setRows(out.data);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (alive) setLoad({ kind: 'error', ...loadErrorMessage(err) });
      });
    return () => {
      alive = false;
    };
  }, [query, status, reloadKey]);

  const filtered = query !== '' || status !== '';
  const clearFilters = useCallback((): void => {
    setQ('');
    setStatus('');
  }, []);

  const remove = async (page: CmsPageSummary): Promise<void> => {
    setNotice(null);
    copier.clearError();
    const deleted = await confirm({
      title: t('pagesList.deleteTitle'),
      message: t('pagesList.deleteConfirm', { name: page.name }),
      confirmLabel: t('listActions.delete'),
      destructive: true,
      action: () => cmsClient.deletePage(page.id),
      describeError: (err) => cmsDeleteErrorMessage(err, t),
      returnFocusTo: removalFocus.returnFocusTo(page),
    });
    if (!deleted) return;
    archiveStatus.clear();
    setRows((current) => current.filter((row) => row.id !== page.id));
    setNotice(t('pagesList.deleted', { name: page.name }));
  };

  const toggleArchive = async (page: CmsPageSummary): Promise<void> => {
    const archiving = page.status !== 'archived';
    setNotice(null);
    copier.clearError();
    archiveStatus.clear();
    setArchivingId(page.id);
    try {
      const updated = archiving ? await cmsClient.archivePage(page.id) : await cmsClient.unarchivePage(page.id);
      if (status !== '' && updated.status !== status) {
        // The row leaves the filtered list; its menu goes with it, so focus moves first.
        removalFocus.returnFocusTo(page)()?.focus();
        setRows((current) => current.filter((row) => row.id !== page.id));
      } else {
        setRows((current) => current.map((row) => (row.id === page.id ? { ...row, status: updated.status } : row)));
      }
      archiveStatus.show(t(archiving ? 'pagesList.archived' : 'pagesList.unarchived', { name: page.name }));
    } catch {
      archiveStatus.show(t(archiving ? 'pagesList.archiveFailed' : 'pagesList.unarchiveFailed', { name: page.name }), 'error');
    } finally {
      setArchivingId(null);
    }
  };

  const createLink = (
    <Button asChild className="min-h-11 sm:min-h-9">
      <Link ref={(element) => { removalFocus.createRef.current = element; }} to="/cms/pages/new">
        <Plus size={16} aria-hidden="true" />
        {t('pagesList.new')}
      </Link>
    </Button>
  );
  // With no page at all the empty state carries the one create action; a
  // second filled button for the same thing in the header would compete (Von Restorff).
  const nothingYet = load.kind === 'ready' && rows.length === 0 && !filtered;

  const columns: ResponsiveColumn<CmsPageSummary>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      primary: true,
      render: (page) => (
        <Link ref={removalFocus.targetRef(page)} to={`/cms/pages/${page.id}`} className="font-medium text-primary hover:underline">
          {page.name}
        </Link>
      ),
      meta: (page) => <code className="text-xs">{page.slug}</code>,
    },
    {
      id: 'slug',
      header: t('columns.slug'),
      hideOnMobile: true,
      render: (page) => <code className="text-xs">{page.slug}</code>,
    },
    {
      id: 'status',
      header: t('columns.status'),
      render: (page) => (
        <span className="flex flex-wrap gap-1">
          <Badge variant={STATUS_VARIANT[page.status]}>{t(`status.${page.status}`)}</Badge>
          {!page.active ? <Badge variant="outline">{t('state.inactive')}</Badge> : null}
          {/* Feature 167 (FR-041) — `/<prefix>/…` is a storefront language page. */}
          {page.shadowedByLanguagePrefix ? (
            <Badge
              variant="destructive"
              title={t('pagesList.shadowedByLanguagePrefixHint', {
                prefix: page.shadowedByLanguagePrefix.prefix,
                channels: page.shadowedByLanguagePrefix.channelCodes.join(', '),
              })}
            >
              {t('pagesList.shadowedByLanguagePrefix', { prefix: page.shadowedByLanguagePrefix.prefix })}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'languages',
      header: t('columns.languages'),
      hideOnMobile: true,
      render: (page) => <span className="text-xs text-muted-foreground">{page.languages.join(', ')}</span>,
    },
  ];

  return (
    <div className="b2b-page b2b-page--wide">
      <ListPage
        title={t('pagesList.title')}
        actions={
          canWrite ? (
            <div className="flex flex-wrap items-center gap-3">
              <InlineStatus {...archiveStatus.props} />
              {nothingYet ? null : createLink}
            </div>
          ) : null
        }
        toolbar={
          <ListToolbar
            className="flex-1"
            label={t('pagesList.toolbarLabel')}
            search={
              <ListToolbarSearch
                ref={searchRef}
                label={t('pagesList.searchLabel')}
                placeholder={t('pagesList.searchPlaceholder')}
                value={q}
                onValueChange={setQ}
              />
            }
            filters={
              <Select
                aria-label={t('pagesList.statusFilter')}
                value={status}
                onChange={(event) => setStatus(event.target.value as CmsPageStatus | '')}
                className="w-44"
              >
                <option value="">{t('pagesList.allStatuses')}</option>
                {PAGE_STATUSES.map((value) => (
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
        count={t('pagesList.count', { count: rows.length })}
        notice={
          copier.error ? (
            <Alert variant="destructive">
              <AlertDescription>{copier.error}</AlertDescription>
            </Alert>
          ) : notice ? (
            <Alert live="polite">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null
        }
        load={load}
        onRetry={() => setReloadKey((key) => key + 1)}
      >
        <ResponsiveTable
          columns={columns}
          data={rows}
          keyExtractor={(page) => page.id}
          emptyState={
            filtered ? (
              <EmptyState variant="no-results" onClearFilters={clearFilters} focusAfterClear={searchRef} />
            ) : (
              <EmptyState
                icon={<FileText size={20} />}
                title={t('pagesList.emptyTitle')}
                description={canWrite ? t('pagesList.emptyBody') : null}
                action={canWrite ? createLink : null}
              />
            )
          }
          {...(canWrite
            ? {
                renderActions: (page: CmsPageSummary) => (
                  <span className="contents" aria-busy={copier.pendingId === page.id || archivingId === page.id}>
                    <RowActionMenu label={t('listActions.label', { name: page.name })}>
                      <RowActionMenuItem asChild>
                        <Link to={`/cms/pages/${page.id}`}>{t('listActions.open')}</Link>
                      </RowActionMenuItem>
                      <RowActionMenuItem
                        disabled={copier.pendingId !== null}
                        onSelect={() => void copier.duplicate(page)}
                      >
                        {t('listActions.duplicate')}
                      </RowActionMenuItem>
                      <RowActionMenuItem disabled={archivingId !== null} onSelect={() => void toggleArchive(page)}>
                        {t(page.status === 'archived' ? 'pagesList.unarchive' : 'pagesList.archive')}
                      </RowActionMenuItem>
                      <RowActionMenuSeparator />
                      <RowActionMenuItem destructive onSelect={() => void remove(page)}>
                        {t('listActions.delete')}
                      </RowActionMenuItem>
                    </RowActionMenu>
                  </span>
                ),
              }
            : {})}
        />
      </ListPage>
      {confirmDialog}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default PagesListPage;
