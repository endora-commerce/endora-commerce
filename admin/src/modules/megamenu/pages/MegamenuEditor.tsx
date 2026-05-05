import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { randomUUID } from '@/lib/uuid';
import type { MegamenuDetail, MegamenuItem, MegamenuItemKind } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Textarea } from '@/components/ui/textarea';
import { BindingsPanel } from '../components/BindingsPanel';
import {
  defaultTargetFor,
  MenuItemConfigPanel,
  type IndexedItem,
} from '../components/MenuItemConfigPanel';
import { MenuItemTree } from '../components/MenuItemTree';
import { megamenuClient } from '../api/megamenu-client';

function indexItems(items: MegamenuItem[]): IndexedItem[] {
  return items
    .filter((item): item is IndexedItem => typeof item.id === 'string')
    .map((item) => ({ ...item, parentId: item.parentId ?? null }));
}

function move(items: IndexedItem[], itemId: string, direction: 'up' | 'down'): IndexedItem[] {
  const target = items.find((i) => i.id === itemId);
  if (!target) return items;
  const siblings = items
    .filter((i) => i.parentId === target.parentId)
    .sort((a, b) => a.position - b.position);
  const index = siblings.findIndex((i) => i.id === itemId);
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= siblings.length) return items;
  const a = siblings[index]!;
  const b = siblings[swapWith]!;
  return items.map((i) => {
    if (i.id === a.id) return { ...i, position: b.position };
    if (i.id === b.id) return { ...i, position: a.position };
    return i;
  });
}

function deleteSubtree(items: IndexedItem[], itemId: string): IndexedItem[] {
  const toDelete = new Set<string>();
  const queue = [itemId];
  while (queue.length > 0) {
    const next = queue.shift()!;
    toDelete.add(next);
    for (const child of items.filter((i) => i.parentId === next)) {
      queue.push(child.id);
    }
  }
  return items.filter((i) => !toDelete.has(i.id));
}

export function MegamenuEditor(): ReactNode {
  const { id } = useParams();
  const [menu, setMenu] = useState<MegamenuDetail | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<IndexedItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Array<{ code: string; message: string }>>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!id) return;
    setError(null);
    try {
      const loaded = await megamenuClient.getMenu(id);
      setMenu(loaded);
      setName(loaded.name);
      setDescription(loaded.description ?? '');
      setItems(indexItems(loaded.items));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const binding of menu?.bindings ?? []) set.add(binding.language);
    return Array.from(set).sort();
  }, [menu?.bindings]);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  const addChild = (parentId: string | null): void => {
    const id = randomUUID();
    const kind: MegamenuItemKind = 'external-link';
    const next: IndexedItem = {
      id,
      parentId,
      position: items.filter((i) => i.parentId === parentId).length,
      kind,
      labels: { 'en-US': 'New item' },
      target: defaultTargetFor(kind) as MegamenuItem['target'],
    } as IndexedItem;
    setItems([...items, next]);
    setSelectedItemId(id);
  };

  const updateItem = (next: IndexedItem): void => {
    setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));
  };

  const saveMetadata = async (): Promise<void> => {
    if (!menu) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await megamenuClient.patchMenu(menu.id, {
        name,
        description: description || null,
        version: menu.version,
      });
      setMenu(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveTree = async (): Promise<void> => {
    if (!menu) return;
    setSaving(true);
    setError(null);
    setWarnings([]);
    try {
      const out = await megamenuClient.putItems(menu.id, {
        items: items.map((i) => ({ ...i }) as MegamenuItem),
        version: menu.version,
      });
      setMenu(out.data);
      setItems(indexItems(out.data.items));
      if (out.meta?.warnings) setWarnings(out.meta.warnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!menu) {
    return <p className="px-2 py-6 text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={menu.name || 'Megamenu'}
        description="Author the navigation tree, scope it to (channel, language), activate it."
        actions={
          <Button asChild variant="outline">
            <Link to="/megamenu">Back</Link>
          </Button>
        }
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {warnings.map((warning) => (
        <Alert key={warning.code} variant="default">
          <AlertDescription>{warning.message}</AlertDescription>
        </Alert>
      ))}

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
              <div className="text-right">
                <Button onClick={() => void saveMetadata()} disabled={saving}>
                  Save metadata
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bindings</CardTitle>
            </CardHeader>
            <CardContent>
              <BindingsPanel menuId={menu.id} bindings={menu.bindings} onChanged={() => void load()} />
            </CardContent>
          </Card>
        </div>

        <div className="col-span-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <MenuItemTree
                items={items}
                selectedItemId={selectedItemId}
                onSelect={setSelectedItemId}
                onMove={(itemId, direction) => setItems((prev) => move(prev, itemId, direction))}
                onDelete={(itemId) => setItems((prev) => deleteSubtree(prev, itemId))}
                onAddChild={addChild}
              />
              <div className="text-right">
                <Button onClick={() => void saveTree()} disabled={saving}>
                  Save tree
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="col-span-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Item</CardTitle>
            </CardHeader>
            <CardContent>
              <MenuItemConfigPanel
                item={selectedItem}
                languages={languages}
                onChange={updateItem}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
