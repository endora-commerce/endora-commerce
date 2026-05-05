import { useMemo, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { MegamenuItem, MegamenuItemKind } from '@b2b/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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

const kindLabel: Record<MegamenuItemKind, string> = {
  'category-link': 'Category',
  'cms-page-link': 'CMS Page',
  'external-link': 'External link',
  button: 'Button',
  asset: 'Asset',
  'cms-block-embed': 'Block embed',
};

function indexItems(items: MegamenuItem[]): IndexedItem[] {
  return items
    .filter((item): item is IndexedItem => typeof item.id === 'string')
    .map((item) => ({ ...item, parentId: item.parentId ?? null }));
}

function pickLabel(labels: Record<string, string> | undefined): string {
  if (!labels) return '(no label)';
  const langs = Object.keys(labels);
  if (langs.length === 0) return '(no label)';
  return labels[langs[0]!] ?? '(no label)';
}

export function MenuItemTree({
  items,
  selectedItemId,
  onSelect,
  onMove,
  onDelete,
  onAddChild,
}: MenuItemTreeProps): ReactNode {
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
            {pickLabel(item.labels)}
            <Badge variant="outline" className="ml-2 text-[10px] uppercase tracking-wide">
              {kindLabel[item.kind]}
            </Badge>
          </button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onMove(item.id, 'up')}
            title="Move up"
          >
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onMove(item.id, 'down')}
            title="Move down"
          >
            <ArrowDown className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onAddChild(item.id)}
            title="Add child item"
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onDelete(item.id)}
            title="Delete item"
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
        <span className="text-sm font-medium">Tree</span>
        <Button type="button" size="sm" variant="outline" onClick={() => onAddChild(null)}>
          <Plus className="mr-1 h-3 w-3" /> Add top-level item
        </Button>
      </div>
      {roots.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">No items yet — add one above.</p>
      ) : (
        roots.map((root) => renderRow(root, 0))
      )}
    </div>
  );
}
