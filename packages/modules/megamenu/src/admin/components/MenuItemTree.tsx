import { useMemo, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { MegamenuItem, MegamenuItemKind } from '@endora-commerce/contracts';
import { Badge, Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { useConfirmDialog } from '@endora-commerce/admin-kit/components';

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
  const { language } = useTranslationContext();
  const { confirm, confirmDialog } = useConfirmDialog();
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

  const countDescendants = (id: string): number =>
    (byParent.get(id) ?? []).reduce((sum, child) => sum + 1 + countDescendants(child.id), 0);

  /**
   * Issue #1464 — deleting an item takes its whole subtree, so it asks first,
   * naming the item and how many nested items go with it, and says that the
   * tree is not changed on the server until it is saved.
   */
  const requestDelete = async (item: IndexedItem): Promise<void> => {
    const label = pickLabel(item.labels, t('tree.noLabel'));
    const nested = countDescendants(item.id);
    const message =
      nested === 0
        ? t('tree.deleteConfirm.message', { label })
        : t(`tree.deleteConfirm.messageNested.${new Intl.PluralRules(language).select(nested)}`, {
            label,
            count: new Intl.NumberFormat(language).format(nested),
          });
    const ok = await confirm({
      title: t('tree.deleteConfirm.title'),
      message,
      confirmLabel: t(nested === 0 ? 'tree.deleteItem' : 'tree.deleteConfirm.actionNested'),
      destructive: true,
    });
    if (ok) onDelete(item.id);
  };

  const renderRow = (item: IndexedItem, depth: number): ReactNode => {
    const children = byParent.get(item.id) ?? [];
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
          <GripVertical className="h-3 w-3 text-muted-foreground" />
          {hasChildren ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
          <button
            type="button"
            className="flex-1 truncate text-left text-sm"
            onClick={() => onSelect(item.id)}
          >
            {pickLabel(item.labels, t('tree.noLabel'))}
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
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onMove(item.id, 'up')}
            title={t('common.moveUp')}
          >
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onMove(item.id, 'down')}
            title={t('common.moveDown')}
          >
            <ArrowDown className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onAddChild(item.id)}
            title={t('tree.addChild')}
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void requestDelete(item)}
            title={t('tree.deleteItem')}
            aria-label={t('tree.deleteItem')}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
        {children.map((child) => renderRow(child, depth + 1))}
      </div>
    );
  };

  const roots = byParent.get(null) ?? [];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between border-b pb-2">
        <span className="text-sm font-medium">{t('tree.title')}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => onAddChild(null)}>
          <Plus className="mr-1 h-3 w-3" /> {t('tree.addTopLevel')}
        </Button>
      </div>
      {roots.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">{t('tree.empty')}</p>
      ) : (
        roots.map((root) => renderRow(root, 0))
      )}
      {confirmDialog}
    </div>
  );
}
