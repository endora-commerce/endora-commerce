import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { BlogCategoryTreeNode as TreeNode } from '@endora-commerce/contracts';
import { Badge, Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

function pickName(name: Record<string, string> | undefined | null, fallback: string): string {
  if (!name) return fallback;
  return name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

interface NodeRowProps {
  node: TreeNode;
  depth: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: (node: TreeNode) => void;
  onMoveDown: (node: TreeNode) => void;
  onAddChild: (parentId: string) => void;
  /**
   * Whether the operator holds `blog.write`.
   *
   * The *+ Child* button navigates to `/blog/categories/new`, which takes the
   * write code since feature 091's batch 16, so a read-only operator pressing
   * it would reach the admin's not-found page. It is a required prop rather
   * than an optional one with a permissive default: a caller that forgets it
   * does not compile, which is the direction a permission gate has to fail in.
   */
  canCreate: boolean;
  onDelete: (node: TreeNode) => void;
}

export function CategoryTreeNode({
  node,
  depth,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onAddChild,
  onDelete,
  canCreate,
}: NodeRowProps): ReactNode {
  const t = useTranslation('blog');

  return (
    <div
      className="flex items-center gap-2 border-b py-2"
      style={{ paddingLeft: `${depth * 24}px` }}
    >
      <span className="font-medium">
        <Link
          to={`/blog/categories/${node.id}`}
          className="text-primary hover:underline"
        >
          {pickName(node.name, node.slug)}
        </Link>
      </span>
      <Badge variant="outline" className="font-mono text-[10px]">
        {node.slug}
      </Badge>
      {!node.enabled ? (
        <Badge variant="outline" className="text-[10px]">
          {t('state.disabled')}
        </Badge>
      ) : null}
      {node.isSystem ? (
        <Badge variant="secondary" className="text-[10px]">
          {t('state.system')}
        </Badge>
      ) : null}
      <span className="ml-auto flex gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canMoveUp}
          onClick={() => onMoveUp(node)}
          aria-label={t('common.moveUp')}
        >
          ↑
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canMoveDown}
          onClick={() => onMoveDown(node)}
          aria-label={t('common.moveDown')}
        >
          ↓
        </Button>
        {canCreate ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onAddChild(node.id)}
          >
            {t('categoryTree.addChild')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={node.isSystem}
          onClick={() => onDelete(node)}
        >
          {t('common.delete')}
        </Button>
      </span>
    </div>
  );
}
