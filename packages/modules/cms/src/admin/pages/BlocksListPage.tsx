import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Blocks, Plus } from 'lucide-react';
import type { CmsBlockSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Badge, Button, EmptyState } from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  useConfirmDialog,
  useRemovalFocus,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cmsClient } from '../api/cms-client.js';
import { cmsDeleteErrorMessage, loadErrorMessage } from '../components/list-delete-error.js';
import { useDuplicateAction } from '../components/duplicate-record.js';

const rowId = (row: { id: string }): string => row.id;

/**
 * The CMS block list — the kit's `ListPage` (issue #1495, UX audit
 * CONTENT-13): one heading, the state as a badge with text, and a row menu
 * that opens a block or deletes it through the confirmation and
 * `DELETE /api/v1/admin/cms/blocks/:id` (refused while a page, a hook or a
 * menu still uses it). The endpoint answers the whole list: no pager, no search.
 * Duplicate (DEC-17) copies the block under a `-copy` code and opens the copy.
 */
export function BlocksListPage(): ReactNode {
  const t = useTranslation('cms');
  const { hasPermission } = useAuth();
  // The create route takes the **write** code (feature 091, batch 16), and so
  // do the row actions, so both are gated on it.
  const canWrite = hasPermission('cms.write');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<CmsBlockSummary[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // After a delete, focus goes to the next row, or to "New …" once the list is empty (WCAG 2.4.3).
  const removalFocus = useRemovalFocus(rows, rowId, load.kind === 'ready');
  // Issue #1495 (DEC-17) — Duplicate opens the copy's editor, or keeps the list with the reason.
  const copier = useDuplicateAction<CmsBlockSummary>({
    run: (block, body) => cmsClient.duplicateBlock(block.id, body),
    editorPath: (id) => `/cms/blocks/${id}`,
    t,
  });

  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading' });
    cmsClient
      .listBlocks()
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
  }, [reloadKey]);

  const remove = async (block: CmsBlockSummary): Promise<void> => {
    setNotice(null);
    copier.clearError();
    const deleted = await confirm({
      title: t('blocksList.deleteTitle'),
      message: t('blocksList.deleteConfirm', { name: block.name }),
      confirmLabel: t('listActions.delete'),
      destructive: true,
      action: () => cmsClient.deleteBlock(block.id),
      describeError: (err) => cmsDeleteErrorMessage(err, t),
      returnFocusTo: removalFocus.returnFocusTo(block),
    });
    if (!deleted) return;
    setRows((current) => current.filter((row) => row.id !== block.id));
    setNotice(t('blocksList.deleted', { name: block.name }));
  };

  const createLink = (
    <Button asChild className="min-h-11 sm:min-h-9">
      <Link ref={(element) => { removalFocus.createRef.current = element; }} to="/cms/blocks/new">
        <Plus size={16} aria-hidden="true" />
        {t('blocksList.new')}
      </Link>
    </Button>
  );
  // With no block at all the empty state carries the one create action (Von Restorff).
  const nothingYet = load.kind === 'ready' && rows.length === 0;

  const columns: ResponsiveColumn<CmsBlockSummary>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      primary: true,
      render: (block) => (
        <Link ref={removalFocus.targetRef(block)} to={`/cms/blocks/${block.id}`} className="font-medium text-primary hover:underline">
          {block.name}
        </Link>
      ),
      meta: (block) => <code className="text-xs">{block.code}</code>,
    },
    {
      id: 'code',
      header: t('columns.code'),
      hideOnMobile: true,
      render: (block) => <code className="text-xs">{block.code}</code>,
    },
    {
      id: 'state',
      header: t('columns.state'),
      render: (block) => (
        <Badge variant={block.active ? 'success' : 'outline'}>
          {block.active ? t('state.active') : t('state.inactive')}
        </Badge>
      ),
    },
    {
      id: 'languages',
      header: t('columns.languages'),
      hideOnMobile: true,
      render: (block) => <span className="text-xs text-muted-foreground">{block.languages.join(', ')}</span>,
    },
  ];

  return (
    <div className="b2b-page b2b-page--wide">
      <ListPage
        title={t('blocksList.title')}
        actions={canWrite && !nothingYet ? createLink : null}
        count={t('blocksList.count', { count: rows.length })}
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
          keyExtractor={(block) => block.id}
          emptyState={
            <EmptyState
              icon={<Blocks size={20} />}
              title={t('blocksList.emptyTitle')}
              description={t('blocksList.emptyBody')}
              action={canWrite ? createLink : null}
            />
          }
          {...(canWrite
            ? {
                renderActions: (block: CmsBlockSummary) => (
                  <span className="contents" aria-busy={copier.pendingId === block.id}>
                    <RowActionMenu label={t('listActions.label', { name: block.name })}>
                      <RowActionMenuItem asChild>
                        <Link to={`/cms/blocks/${block.id}`}>{t('listActions.open')}</Link>
                      </RowActionMenuItem>
                      <RowActionMenuItem
                        disabled={copier.pendingId !== null}
                        onSelect={() => void copier.duplicate(block)}
                      >
                        {t('listActions.duplicate')}
                      </RowActionMenuItem>
                      <RowActionMenuSeparator />
                      <RowActionMenuItem destructive onSelect={() => void remove(block)}>
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
export default BlocksListPage;
