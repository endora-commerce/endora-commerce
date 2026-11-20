import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { FolderTree, Plus } from 'lucide-react';
import { ListPage, useConfirmDialog, type ListPageLoad } from '@endora-commerce/admin-kit/components';
import { Link, useNavigate } from 'react-router-dom';
import type { BlogCategoryTreeMove, BlogCategoryTreeNode as TreeNode } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, EmptyState } from '@endora-commerce/admin-kit/ui';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { blogClient } from '../api/blog-client.js';
import { CategoryTreeNode } from '../components/CategoryTreeNode.js';
import { loadErrorMessage } from '../components/list-errors.js';

interface FlatNode {
  node: TreeNode;
  parentId: string | null;
  position: number;
  depth: number;
  siblingsTotal: number;
}

function flatten(tree: TreeNode[]): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (nodes: TreeNode[], parentId: string | null, depth: number): void => {
    const total = nodes.length;
    nodes.forEach((node, position) => {
      out.push({ node, parentId, position, depth, siblingsTotal: total });
      if (node.children.length > 0) walk(node.children, node.id, depth + 1);
    });
  };
  walk(tree, null, 0);
  return out;
}

export function BlogCategoryTreePage(): ReactNode {
  const t = useTranslation('blog');
  const tc = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  const { hasPermission } = useAuth();
  // The create route this screen links to takes the **write** code (feature
  // 091, batch 16), so the button is gated on the same one: a link whose
  // destination the operator's codes cannot open answers the admin's not-found
  // page, which says nothing about permissions at all. That is batch 14's
  // `/sales-channels/new` shape, applied to the five create entry points these
  // two modules have.
  const canWrite = hasPermission('blog.write');
  const navigate = useNavigate();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [listLoad, setListLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setListLoad({ kind: 'loading' });
    setError(null);
    try {
      const out = await blogClient.getCategoryTree();
      setTree(out.tree);
      setListLoad({ kind: 'ready' });
    } catch (err) {
      setListLoad({ kind: 'error', ...loadErrorMessage(err) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onMove = useCallback(
    async (target: TreeNode, direction: 'up' | 'down', siblings: FlatNode[]) => {
      const targetIdx = siblings.findIndex((s) => s.node.id === target.id);
      if (targetIdx < 0) return;
      const swapIdx = direction === 'up' ? targetIdx - 1 : targetIdx + 1;
      if (swapIdx < 0 || swapIdx >= siblings.length) return;

      // Two-move atomic swap inside the parent slot.
      const moves: BlogCategoryTreeMove[] = [
        {
          id: target.id,
          parentId: siblings[targetIdx]!.parentId,
          position: siblings[swapIdx]!.position,
        },
        {
          id: siblings[swapIdx]!.node.id,
          parentId: siblings[swapIdx]!.parentId,
          position: siblings[targetIdx]!.position,
        },
      ];
      setWorking(true);
      setError(null);
      try {
        const out = await blogClient.applyCategoryTreeMoves(moves);
        setTree(out.tree);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setWorking(false);
      }
    },
    [],
  );

  const onDelete = useCallback(
    async (node: TreeNode) => {
      const ok = await confirm({
        message: t('categoryTree.deleteConfirm', { slug: node.slug }),
        confirmLabel: tc('common.action.delete'),
        destructive: true,
      });
      if (!ok) return;
      setWorking(true);
      setError(null);
      try {
        await blogClient.deleteCategory(node.id, node.version);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setWorking(false);
      }
    },
    [load, confirm, t, tc],
  );

  const onAddChild = useCallback(
    (parentId: string) => {
      navigate(`/blog/categories/new?parentId=${encodeURIComponent(parentId)}`);
    },
    [navigate],
  );

  const flat = flatten(tree);
  const createLink = (
    <Button asChild className="min-h-11 sm:min-h-9">
      {/* The router's link, not a raw `href`: under a base path a raw one leaves the admin. */}
      <Link to="/blog/categories/new">
        <Plus size={16} aria-hidden="true" />
        {t('categoryTree.newCategory')}
      </Link>
    </Button>
  );
  // With no category at all the empty state carries the one create action (Von Restorff).
  const nothingYet = listLoad.kind === 'ready' && flat.length === 0;

  // Issue #1495 (UX audit CONTENT-13): the kit's list page — one heading, no
  // card titled "Tree" under it, a skeleton and the kit empty state.
  return (
    <>
      <ListPage
        title={t('categoryTree.title')}
        description={t('categoryTree.defaultNote')}
        actions={canWrite && !nothingYet ? createLink : null}
        notice={
          error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null
        }
        load={listLoad}
        onRetry={() => void load()}
      >
        {flat.length === 0 ? (
          <EmptyState
            icon={<FolderTree size={20} />}
            title={t('categoryTree.emptyTitle')}
            description={t('categoryTree.emptyBody')}
            action={canWrite ? createLink : null}
          />
        ) : (
          <div className="rounded border">
            {flat.map((entry) => {
              // Build the same-parent siblings list once per render — needed
              // by the up/down handlers to compute the swap target.
              const siblings = flat.filter(
                (s) => (s.parentId ?? null) === (entry.parentId ?? null) && s.depth === entry.depth,
              );
              const idx = siblings.findIndex((s) => s.node.id === entry.node.id);
              return (
                <CategoryTreeNode
                  key={entry.node.id}
                  node={entry.node}
                  depth={entry.depth}
                  canMoveUp={idx > 0 && !working}
                  canMoveDown={idx < siblings.length - 1 && !working}
                  onMoveUp={() => void onMove(entry.node, 'up', siblings)}
                  onMoveDown={() => void onMove(entry.node, 'down', siblings)}
                  onAddChild={onAddChild}
                  canCreate={canWrite}
                  onDelete={() => void onDelete(entry.node)}
                />
              );
            })}
          </div>
        )}
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
export default BlogCategoryTreePage;
