import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Newspaper, Plus } from 'lucide-react';
import type { BlogPostStatus, BlogPostSummary } from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
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
  useListPagination,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { blogClient } from '../api/blog-client.js';
import { PostStatusBadge } from '../components/PostStatusBadge.js';
import { loadErrorMessage } from '../components/list-errors.js';

/** `GET /api/v1/admin/blog/posts` serves at most 100 posts a page. */
const MAX_PAGE_SIZE = 100;

const POST_STATUSES: readonly BlogPostStatus[] = ['draft', 'published', 'archived'];

type StatusFilter = BlogPostStatus | '';

const rowId = (row: { id: string }): string => row.id;

function pickPrimaryName(name: Record<string, string> | undefined | null, fallback: string): string {
  if (!name) return fallback;
  return name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

/**
 * The blog post list — the kit's `ListPage` (issue #1495, UX audit
 * CONTENT-13): one heading, a search that runs as the operator types and a
 * status filter, the kit pager over the server's pages, statuses as translated
 * badges, and a row menu that opens a post or deletes it through the
 * confirmation and `DELETE /api/v1/admin/blog/posts/:id`, naming the version
 * the row was read at.
 *
 * Archive / Unarchive sit between them, at the row's version too. Archiving is
 * reversible and the post editor does it without asking, so the menu does too:
 * the badge and version change in place, the result is said beside "New post"
 * (DEC-12 a) and focus stays on the row's menu trigger; a row the status filter
 * no longer matches leaves the list, and focus moves to its neighbour. The
 * module has no `/unarchive`: Unarchive is `/unpublish`, which returns the post
 * to a draft — as the CMS page list's Unarchive does — rather than putting it
 * back on the storefront unreviewed.
 */
export function BlogPostListPage(): ReactNode {
  const t = useTranslation('blog');
  const { hasPermission } = useAuth();
  // The create route this screen links to takes the **write** code (feature
  // 091, batch 16), so the button is gated on the same one; so are the row
  // actions, which write.
  const canWrite = hasPermission('blog.write');
  const { confirm, confirmDialog } = useConfirmDialog();
  const pager = useListPagination({ scope: 'blog-posts', maxPageSize: MAX_PAGE_SIZE });
  const { resetPage, syncTotal } = pager;
  const searchRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<BlogPostSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const query = useDebouncedValue(q.trim());
  const [status, setStatus] = useState<StatusFilter>('');
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const { page, pageSize } = pager.query;
  // After a delete, focus goes to the next row, or to "New post" once the list is empty (WCAG 2.4.3).
  const removalFocus = useRemovalFocus(rows, rowId, load.kind === 'ready');
  // The result of Archive / Unarchive, in a region mounted before it has text (SC 4.1.3).
  const archiveStatus = useInlineStatus();
  const [archivingId, setArchivingId] = useState<string | null>(null);

  // A new search goes back to the first page.
  useEffect(() => {
    resetPage();
  }, [query, resetPage]);

  useEffect(() => {
    // A response that lands after a newer request was sent is dropped.
    let alive = true;
    setLoad({ kind: 'loading' });
    blogClient
      .listPosts({ ...(query ? { q: query } : {}), ...(status ? { status } : {}), page, perPage: pageSize })
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
  }, [query, status, page, pageSize, reloadKey, syncTotal]);

  const filtered = query !== '' || status !== '';
  const clearFilters = useCallback((): void => {
    setQ('');
    setStatus('');
    resetPage();
  }, [resetPage]);

  const remove = async (post: BlogPostSummary): Promise<void> => {
    setNotice(null);
    const name = pickPrimaryName(post.name, post.slug);
    const deleted = await confirm({
      title: t('postList.deleteTitle'),
      message: t('postList.deleteConfirm', { name }),
      confirmLabel: t('listActions.delete'),
      destructive: true,
      action: () => blogClient.deletePost(post.id, post.version),
      // The likely cause is a row changed by someone else since it was read; a reload reads it again.
      describeError: () => t('listActions.deleteFailed'),
      returnFocusTo: removalFocus.returnFocusTo(post),
    });
    if (!deleted) return;
    archiveStatus.clear();
    setNotice(t('postList.deleted', { name }));
    // The row goes in place rather than through a reload, so the row focus moved to stays
    // mounted. A page emptied this way moves back through `syncTotal`, which reads again.
    setRows((current) => current.filter((row) => row.id !== post.id));
    setTotal((current) => current - 1);
    syncTotal(total - 1);
  };

  const toggleArchive = async (post: BlogPostSummary): Promise<void> => {
    const archiving = post.status !== 'archived';
    const name = pickPrimaryName(post.name, post.slug);
    setNotice(null);
    archiveStatus.clear();
    setArchivingId(post.id);
    try {
      const updated = archiving
        ? await blogClient.archivePost(post.id, post.version)
        : await blogClient.unpublishPost(post.id, post.version);
      if (status !== '' && updated.status !== status) {
        // The row leaves the filtered page; its menu goes with it, so focus moves first.
        removalFocus.returnFocusTo(post)()?.focus();
        setRows((current) => current.filter((row) => row.id !== post.id));
        setTotal((current) => current - 1);
        syncTotal(total - 1);
      } else {
        setRows((current) =>
          current.map((row) =>
            row.id === post.id ? { ...row, status: updated.status, version: updated.version } : row,
          ),
        );
      }
      archiveStatus.show(t(archiving ? 'postList.archived' : 'postList.unarchived', { name }));
    } catch {
      archiveStatus.show(t(archiving ? 'postList.archiveFailed' : 'postList.unarchiveFailed', { name }), 'error');
    } finally {
      setArchivingId(null);
    }
  };

  const createLink = (
    <Button asChild className="min-h-11 sm:min-h-9">
      <Link
        ref={(element) => {
          removalFocus.createRef.current = element;
        }}
        to="/blog/posts/new"
      >
        <Plus size={16} aria-hidden="true" />
        {t('postList.newPost')}
      </Link>
    </Button>
  );
  // With no post at all the empty state carries the one create action (Von Restorff).
  const nothingYet = load.kind === 'ready' && total === 0 && !filtered;

  const columns: ResponsiveColumn<BlogPostSummary>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      primary: true,
      render: (post) => (
        <Link ref={removalFocus.targetRef(post)} to={`/blog/posts/${post.id}`} className="font-medium text-primary hover:underline">
          {pickPrimaryName(post.name, post.slug)}
        </Link>
      ),
      meta: (post) => <code className="text-xs">{post.slug}</code>,
    },
    {
      id: 'slug',
      header: t('columns.slug'),
      hideOnMobile: true,
      render: (post) => <code className="text-xs">{post.slug}</code>,
    },
    {
      id: 'status',
      header: t('columns.status'),
      render: (post) => <PostStatusBadge status={post.status} active={post.active} />,
    },
    {
      id: 'languages',
      header: t('columns.languages'),
      hideOnMobile: true,
      render: (post) => <span className="text-xs text-muted-foreground">{post.languages.join(', ')}</span>,
    },
    {
      id: 'version',
      header: t('columns.version'),
      hideOnMobile: true,
      className: 'text-right',
      render: (post) => <span className="text-xs text-muted-foreground">v{post.version}</span>,
    },
  ];

  return (
    <>
      <ListPage
        title={t('postList.title')}
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
            label={t('postList.toolbarLabel')}
            search={
              <ListToolbarSearch
                ref={searchRef}
                label={t('postList.searchLabel')}
                placeholder={t('postList.searchPlaceholder')}
                value={q}
                onValueChange={setQ}
              />
            }
            filters={
              <Select
                aria-label={t('postList.statusFilter')}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as StatusFilter);
                  resetPage();
                }}
                className="w-44"
              >
                <option value="">{t('postList.allStatuses')}</option>
                {POST_STATUSES.map((value) => (
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
        count={t('postList.count', { count: total })}
        notice={
          notice ? (
            <Alert live="polite">
              <AlertDescription>{notice}</AlertDescription>
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
          keyExtractor={(post) => post.id}
          emptyState={
            filtered ? (
              <EmptyState variant="no-results" onClearFilters={clearFilters} focusAfterClear={searchRef} />
            ) : (
              <EmptyState
                icon={<Newspaper size={20} />}
                title={t('postList.emptyTitle')}
                description={canWrite ? t('postList.emptyBody') : null}
                action={canWrite ? createLink : null}
              />
            )
          }
          {...(canWrite
            ? {
                renderActions: (post: BlogPostSummary) => (
                  <RowActionMenu label={t('listActions.label', { name: pickPrimaryName(post.name, post.slug) })}>
                    <RowActionMenuItem asChild>
                      <Link to={`/blog/posts/${post.id}`}>{t('listActions.open')}</Link>
                    </RowActionMenuItem>
                    <RowActionMenuItem disabled={archivingId !== null} onSelect={() => void toggleArchive(post)}>
                      {t(post.status === 'archived' ? 'postList.unarchive' : 'postList.archive')}
                    </RowActionMenuItem>
                    <RowActionMenuSeparator />
                    <RowActionMenuItem destructive onSelect={() => void remove(post)}>
                      {t('listActions.delete')}
                    </RowActionMenuItem>
                  </RowActionMenu>
                ),
              }
            : {})}
        />
      </ListPage>
      {confirmDialog}
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default BlogPostListPage;
