import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BlogCategoryTreeMove, BlogCategoryTreeNode as TreeNode } from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { useTranslation } from '@/i18n/useTranslation';
import { blogClient } from '../api/blog-client';
import { CategoryTreeNode } from '../components/CategoryTreeNode';

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
  const navigate = useNavigate();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await blogClient.getCategoryTree();
      setTree(out.tree);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
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
      if (!window.confirm(t('categoryTree.deleteConfirm', { slug: node.slug }))) return;
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
    [load],
  );

  const onAddChild = useCallback(
    (parentId: string) => {
      navigate(`/blog/categories/new?parentId=${encodeURIComponent(parentId)}`);
    },
    [navigate],
  );

  const flat = flatten(tree);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('categoryTree.title')}
        description={t('categoryTree.description')}
        actions={
          <Button asChild>
            <a href="/blog/categories/new">{t('categoryTree.newCategory')}</a>
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('categoryTree.cardTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : flat.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('categoryTree.empty')}</p>
          ) : (
            <div className="rounded border">
              {flat.map((entry) => {
                // Build the same-parent siblings list once per render — needed
                // by the up/down handlers to compute the swap target.
                const siblings = flat.filter(
                  (s) =>
                    (s.parentId ?? null) === (entry.parentId ?? null) &&
                    s.depth === entry.depth,
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
                    onDelete={() => void onDelete(entry.node)}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
