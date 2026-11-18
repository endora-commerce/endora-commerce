import { useMemo, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { MegamenuItem, MegamenuItemKind } from '@endora-commerce/contracts';
import { Badge, Button } from '@endora-commerce/admin-kit/ui';
import { RowActionMenu, RowActionMenuItem, RowActionMenuSeparator } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

interface MenuItemTreeProps {
  items: MegamenuItem[];
  selectedItemId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string | null) => void;
}

type IndexedItem = MegamenuItem & {
  id: string;
  parentId: string | null;
  position: number;
};

function kindLabel(t: (key: string) => string, kind: MegamenuItemKind): string {
  return t(`treeKind.${kind}`);
}

function indexItems(items: MegamenuItem[]): IndexedItem[] {
  return items
    .filter((item): item is IndexedItem => typeof item.id === 'string')
    .map((item) => ({ ...item, parentId: item.parentId ?? null }));
}

function pickLabel(labels: Record<string, string> | undefined, fallback: string): string {
  if (!labels) return fallback;
  const langs = Object.keys(labels);
  if (langs.length === 0) return fallback;
  return labels[langs[0]!] ?? fallback;
}

export function MenuItemTree({
  items,
  selectedItemId,
  onSelect,
  onMove,
  onDelete,
  onAddChild,
}: MenuItemTreeProps): ReactNode {
  const t = useTranslation('megamenu');
  const indexed = useMemo(() => indexItems(items), [items]);
  const byParent = useMemo(() => {
    const map = new Map<string | null, IndexedItem[]>();
    for (const item of indexed) {
      const list = map.get(item.parentId) ?? [];
      list.push(item);
      map.set(item.parentId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.position - b.position);
    }
    return map;
  }, [indexed]);

  const renderRow = (item: IndexedItem, depth: number, index: number, siblingCount: number): ReactNode => {
    const children = byParent.get(item.id) ?? [];
    const isFirst = index === 0;
    const isLast = index === siblingCount - 1;
    const label = pickLabel(item.labels, t('tree.noLabel'));
    const isSelected = item.id === selectedItemId;
    const hasChildren = children.length > 0;
    return (
      <div key={item.id}>
        <div
          className={`flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted ${
            isSelected ? 'bg-muted/60 ring-1 ring-primary/40' : ''
          }`}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          <GripVertical aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
          {hasChildren ? (
            <ChevronDown aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
          )}
          <button
            type="button"
            className="flex-1 truncate text-left text-sm"
            onClick={() => onSelect(item.id)}
          >
            {label}
            <Badge variant="outline" className="ml-2 text-[10px] uppercase tracking-wide">
              {kindLabel(t, item.kind)}
            </Badge>
            {item.parentId === null && item.presentation ? (
              <Badge variant="outline" className="ml-1 text-[10px]">
                {t(`presentation.${item.presentation}`)}
              </Badge>
            ) : null}
            {item.audience && item.audience.kind !== 'everyone' ? (
              // Feature 168 (FR-021): who may see an item is visible in the tree,
              // so a hidden branch is not a surprise on the storefront.
              <Badge variant="secondary" className="ml-1 text-[10px]">
                {t(`audience.${item.audience.kind}`)}
              </Badge>
            ) : null}
          </button>
          {/* Reordering is the frequent action, so it stays inline as two
              32 px icon buttons named by `aria-label` (WCAG 2.5.8, 4.1.2;
              Fitts). Adding a child and the destructive delete go into the row
              menu, delete last and apart from the moves. */}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => onMove(item.id, 'up')}
            disabled={isFirst}
            aria-label={t('common.moveUp')}
            title={t('common.moveUp')}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => onMove(item.id, 'down')}
            disabled={isLast}
            aria-label={t('common.moveDown')}
            title={t('common.moveDown')}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <RowActionMenu label={t('tree.rowActions', { label })}>
            <RowActionMenuItem onSelect={() => onAddChild(item.id)}>
              <Plus aria-hidden="true" />
              {t('tree.addChild')}
            </RowActionMenuItem>
            <RowActionMenuSeparator />
            <RowActionMenuItem destructive onSelect={() => onDelete(item.id)}>
              <Trash2 aria-hidden="true" />
              {t('tree.deleteItem')}
            </RowActionMenuItem>
          </RowActionMenu>
        </div>
        {children.map((child, i) => renderRow(child, depth + 1, i, children.length))}
      </div>
    );
  };

  const roots = byParent.get(null) ?? [];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between border-b pb-2">
        <span className="text-sm font-medium">{t('tree.title')}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => onAddChild(null)}>
          <Plus aria-hidden="true" className="mr-1 h-3 w-3" /> {t('tree.addTopLevel')}
        </Button>
      </div>
      {roots.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">{t('tree.empty')}</p>
      ) : (
        roots.map((root, i) => renderRow(root, 0, i, roots.length))
      )}
    </div>
  );
}
