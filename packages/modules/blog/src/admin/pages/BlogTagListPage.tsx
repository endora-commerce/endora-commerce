import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, Tag } from 'lucide-react';
import type { BlogTagDetail } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, EmptyState } from '@endora-commerce/admin-kit/ui';
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
  useListPagination,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { blogClient } from '../api/blog-client.js';
import { loadErrorMessage } from '../components/list-errors.js';
import { TagDialog } from '../components/TagDialog.js';

/** `GET /api/v1/admin/blog/tags` serves at most 100 tags a page. */
const MAX_PAGE_SIZE = 100;

function pickName(name: Record<string, string> | undefined | null, fallback: string): string {
  if (!name) return fallback;
  return name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

type Notice = { kind: 'done' | 'blocked'; text: string };

/**
 * The blog tag list — the kit's `ListPage` (issue #1495, UX audit
 * CONTENT-13): one heading, a search that runs as the operator types, the kit
 * pager, and a row menu with *Edit* and *Delete*. Create and edit open
 * `TagDialog` instead of a form card drawn open above the list (issue #1538,
 * CONTENT-21). A tag still on posts is refused by the server, so the screen
 * asks for its references first and says which posts hold it instead of
 * offering a confirmation that can only fail.
 */
export function BlogTagListPage(): ReactNode {
  const t = useTranslation('blog');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('blog.write');
  const { confirm, confirmDialog } = useConfirmDialog();
  const pager = useListPagination({ scope: 'blog-tags', maxPageSize: MAX_PAGE_SIZE });
  const { resetPage, syncTotal } = pager;
  const searchRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<BlogTagDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const query = useDebouncedValue(q.trim());
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  // `undefined`: closed; `null`: creating; a tag: editing it.
  const [dialogTag, setDialogTag] = useState<BlogTagDetail | null | undefined>(undefined);
  const { page, pageSize } = pager.query;

  useEffect(() => {
    resetPage();
  }, [query, resetPage]);

  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading' });
    blogClient
      .listTags({ ...(query ? { q: query } : {}), page, perPage: pageSize })
      .then((out) => {
        if (!alive) return;
        setRows(out.data);
        setTotal(out.pagination.totalItems);
        syncTotal(out.pagination.totalItems);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (alive) setLoad({ kind: 'error', ...loadErrorMessage(err) });
      });
    return () => {
      alive = false;
    };
  }, [query, page, pageSize, reloadKey, syncTotal]);

  const filtered = query !== '';
  const clearFilters = useCallback((): void => {
    setQ('');
    resetPage();
  }, [resetPage]);

  const remove = async (tag: BlogTagDetail): Promise<void> => {
    setNotice(null);
    let inUse: { count: number; slugs: string } | null = null;
    try {
      const probe = await blogClient.getTagInboundReferences(tag.id);
      if (probe.totalPosts > 0) inUse = { count: probe.totalPosts, slugs: probe.posts.map((p) => p.slug).join(', ') };
    } catch {
      // Without the probe the delete is still asked; the server refuses a tag in use.
    }
    if (inUse) {
      setNotice({ kind: 'blocked', text: t('tagList.deleteBlocked', { code: tag.code, ...inUse }) });
      return;
    }
    const deleted = await confirm({
      title: t('tagList.deleteTitle'),
      message: t('tagList.deleteConfirm', { code: tag.code }),
      confirmLabel: t('listActions.delete'),
      destructive: true,
      action: () => blogClient.deleteTag(tag.id, tag.version),
      describeError: () => t('listActions.deleteFailed'),
    });
    if (!deleted) return;
    setNotice({ kind: 'done', text: t('tagList.deleted', { code: tag.code }) });
    setReloadKey((key) => key + 1);
  };

  const newTag = (
    <Button type="button" className="min-h-11 sm:min-h-9" onClick={() => setDialogTag(null)}>
      <Plus size={16} aria-hidden="true" />
      {t('tagList.newTag')}
    </Button>
  );
  // With no tag at all the empty state carries the one create action (Von Restorff).
  const nothingYet = load.kind === 'ready' && total === 0 && !filtered;

  const columns: ResponsiveColumn<BlogTagDetail>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      primary: true,
      render: (tag) => <span className="font-medium">{pickName(tag.name, tag.code)}</span>,
      meta: (tag) => <code className="text-xs">{tag.code}</code>,
    },
    {
      id: 'code',
      header: t('columns.code'),
      hideOnMobile: true,
      render: (tag) => <code className="text-xs">{tag.code}</code>,
    },
    {
      id: 'version',
      header: t('columns.version'),
      hideOnMobile: true,
      className: 'text-right',
      render: (tag) => <span className="text-xs text-muted-foreground">v{tag.version}</span>,
    },
  ];

  return (
    <>
      <ListPage
        title={t('tagList.title')}
        actions={canWrite && !nothingYet ? newTag : null}
        toolbar={
          <ListToolbar
            className="flex-1"
            label={t('tagList.toolbarLabel')}
            search={
              <ListToolbarSearch
                ref={searchRef}
                label={t('tagList.searchLabel')}
                placeholder={t('tagList.searchPlaceholder')}
                value={q}
                onValueChange={setQ}
              />
            }
          />
        }
        count={t('tagList.count', { count: total })}
        notice={
          notice ? (
            <Alert variant={notice.kind === 'blocked' ? 'warning' : 'default'} live="polite">
              <AlertDescription>{notice.text}</AlertDescription>
            </Alert>
          ) : null
        }
        load={load}
        onRetry={() => setReloadKey((key) => key + 1)}
        pagination={pager.footer(total)}
      >
        <ResponsiveTable
          columns={columns}
          data={rows}
          keyExtractor={(tag) => tag.id}
          emptyState={
            filtered ? (
              <EmptyState variant="no-results" onClearFilters={clearFilters} focusAfterClear={searchRef} />
            ) : (
              <EmptyState
                icon={<Tag size={20} />}
                title={t('tagList.emptyTitle')}
                description={t('tagList.emptyBody')}
                action={canWrite ? newTag : null}
              />
            )
          }
          {...(canWrite
            ? {
                renderActions: (tag: BlogTagDetail) => (
                  <RowActionMenu label={t('listActions.label', { name: pickName(tag.name, tag.code) })}>
                    <RowActionMenuItem onSelect={() => setDialogTag(tag)}>{t('listActions.edit')}</RowActionMenuItem>
                    <RowActionMenuSeparator />
                    <RowActionMenuItem destructive onSelect={() => void remove(tag)}>
                      {t('listActions.delete')}
                    </RowActionMenuItem>
                  </RowActionMenu>
                ),
              }
            : {})}
        />
      </ListPage>
      {dialogTag !== undefined ? (
        <TagDialog
          tag={dialogTag}
          onClose={() => setDialogTag(undefined)}
          onSaved={(code) => {
            setNotice({
              kind: 'done',
              text: dialogTag ? t('tagList.updated', { code }) : t('tagList.created', { code }),
            });
            setDialogTag(undefined);
            setReloadKey((key) => key + 1);
          }}
        />
      ) : null}
      {confirmDialog}
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default BlogTagListPage;
