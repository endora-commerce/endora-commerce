import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { isDraftEqual, randomUUID } from '@endora-commerce/admin-kit/lib';
import { UnsavedChangesHint, useUnsavedChangesGuard } from '@endora-commerce/admin-kit/components';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, FormField, Input, PageHeader, Textarea } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { MegamenuDetail, MegamenuItem, MegamenuItemKind } from '@endora-commerce/contracts';

import { BindingsPanel } from '../components/BindingsPanel.js';
import {
  defaultTargetFor,
  MenuItemConfigPanel,
  type IndexedItem,
} from '../components/MenuItemConfigPanel.js';
import { MenuItemTree } from '../components/MenuItemTree.js';
import { megamenuClient } from '../api/megamenu-client.js';

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
  const t = useTranslation('megamenu');
  const { id } = useParams();
  const [menu, setMenu] = useState<MegamenuDetail | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<IndexedItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Array<{ code: string; message: string }>>([]);
  const [saving, setSaving] = useState(false);

  /**
   * `keepDrafts` re-reads the menu without touching what the operator is editing:
   * a binding saves on its own and reloads, and that reload used to put the
   * stored tree back over an unsaved one (issue #1461).
   */
  const load = useCallback(async (options: { keepDrafts?: boolean } = {}): Promise<void> => {
    if (!id) return;
    setError(null);
    try {
      const loaded = await megamenuClient.getMenu(id);
      setMenu(loaded);
      if (options.keepDrafts) return;
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
      labels: { [languages[0] ?? 'en-US']: t('editor.newItemLabel') },
      target: defaultTargetFor(kind) as MegamenuItem['target'],
      // Feature 168: a top-level item is a tab of the bar and needs a
      // presentation; a new one starts as a plain link at the start.
      ...(parentId === null ? { presentation: 'link' as const, alignment: 'start' as const } : {}),
    } as IndexedItem;
    setItems([...items, next]);
    setSelectedItemId(id);
  };

  const updateItem = (next: IndexedItem): void => {
    setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));
  };

  /** Saves the name and description on `base`; the menu as saved, or `null` when refused. */
  const saveMetadata = async (base: MegamenuDetail | null = menu): Promise<MegamenuDetail | null> => {
    if (!base) return null;
    setSaving(true);
    setError(null);
    try {
      const updated = await megamenuClient.patchMenu(base.id, {
        name,
        description: description || null,
        version: base.version,
      });
      setMenu(updated);
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSaving(false);
    }
  };

  /** Saves the item tree on `base`; the menu as saved, or `null` when refused. */
  const saveTree = async (base: MegamenuDetail | null = menu): Promise<MegamenuDetail | null> => {
    if (!base) return null;
    setSaving(true);
    setError(null);
    setWarnings([]);
    try {
      const out = await megamenuClient.putItems(base.id, {
        items: items.map((i) => ({ ...i }) as MegamenuItem),
        version: base.version,
      });
      setMenu(out.data);
      setItems(indexItems(out.data.items));
      if (out.meta?.warnings) setWarnings(out.meta.warnings);
      return out.data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Issue #1461 (CONTENT-02) — each card's draft against the last saved menu.
  const metadataDirty = menu !== null && (name !== menu.name || description !== (menu.description ?? ''));
  const treeDirty = menu !== null && !isDraftEqual(items, indexItems(menu.items));
  const unsavedGuard = useUnsavedChangesGuard({
    dirty: metadataDirty || treeDirty,
    // The leave dialog's Save covers both cards, in turn, each on the version the previous one answered with.
    onSave: async () => {
      let base = menu;
      if (metadataDirty) base = await saveMetadata(base);
      if (base && treeDirty) base = await saveTree(base);
      return base !== null;
    },
    onDiscard: () => {
      if (!menu) return;
      setName(menu.name);
      setDescription(menu.description ?? '');
      setItems(indexItems(menu.items));
    },
  });

  if (!menu) {
    return <p className="px-2 py-6 text-sm text-muted-foreground">{t('common.loading')}</p>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ label: t('common.back'), to: '/megamenu' }}
        title={menu.name || t('editor.fallbackTitle')}
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
              <CardTitle>{t('sections.metadata')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField label={t('fields.name')}>
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </FormField>
              <FormField label={t('fields.description')}>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </FormField>
              <div className="flex items-center justify-end gap-2">
                <UnsavedChangesHint dirty={metadataDirty} />
                <Button onClick={() => void saveMetadata()} disabled={saving}>
                  {t('common.saveMetadata')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('sections.bindings')}</CardTitle>
            </CardHeader>
            <CardContent>
              <BindingsPanel menuId={menu.id} bindings={menu.bindings} onChanged={() => void load({ keepDrafts: true })} />
            </CardContent>
          </Card>
        </div>

        <div className="col-span-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.items')}</CardTitle>
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
              <div className="flex items-center justify-end gap-2">
                <UnsavedChangesHint dirty={treeDirty} />
                <Button onClick={() => void saveTree()} disabled={saving}>
                  {t('common.saveTree')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="col-span-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.item')}</CardTitle>
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
      {unsavedGuard.dialog}
    </div>
  );
}
export default MegamenuEditor;
