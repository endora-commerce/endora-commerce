import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { isDraftEqual, randomUUID } from '@endora-commerce/admin-kit/lib';
import { ImmediateBadge, UnsavedChangesHint, useUnsavedChangesGuard } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  InlineStatus,
  Input,
  PageHeader,
  SaveButtonGroup,
  Textarea,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
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

/**
 * The megamenu editor.
 *
 * **One Save** (issue #1512, UX audit CONTENT-09; owner decision DEC-08): the header's
 * `SaveButtonGroup` saves the name and description and then the item tree — each only when it
 * changed, the tree on the version the name answered with — and says the result in an
 * `InlineStatus` beside it. The bindings are the one part that applies at once (each add, remove,
 * activate and deactivate is its own write), so their section heading carries the kit's
 * `ImmediateBadge` and their results are said in that section.
 *
 * **Layout** (issue #1534, CONTENT-16): two rows whose columns start at `lg` and stack below it —
 * the metadata beside the bindings, then the tree beside the item panel that edits it.
 */
export function MegamenuEditor(): ReactNode {
  const t = useTranslation('megamenu');
  const { id } = useParams();
  const navigate = useNavigate();
  const saveStatus = useInlineStatus();
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
    saveStatus.clear();
    setItems([...items, next]);
    setSelectedItemId(id);
  };

  const updateItem = (next: IndexedItem): void => {
    saveStatus.clear();
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
  const dirty = metadataDirty || treeDirty;

  /** The one Save: the name and description, then the tree, each only when changed and each on the version the previous one answered with. */
  const save = async (): Promise<boolean> => {
    saveStatus.clear();
    let base = menu;
    if (metadataDirty) base = await saveMetadata(base);
    if (base && treeDirty) base = await saveTree(base);
    if (base !== null) saveStatus.show(t('editor.saved'));
    return base !== null;
  };

  const unsavedGuard = useUnsavedChangesGuard({
    dirty,
    // The leave dialog's Save is the header's Save.
    onSave: save,
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
        actions={
          <div data-save-actions className="flex flex-wrap items-center justify-end gap-2">
            <UnsavedChangesHint dirty={dirty} />
            <InlineStatus {...saveStatus.props} />
            <SaveButtonGroup
              onSave={() => void save()}
              onSaveAndExit={async () => {
                if (await save()) navigate('/megamenu');
              }}
              saving={saving}
              saveLabel={t('common.save')}
              savingLabel={t('common.saving')}
              saveAndExitLabel={t('common.saveAndExit')}
            />
          </div>
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

      {/* What the menu is and where it shows. Columns from `lg`, stacked below (WCAG 1.4.10). */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.metadata')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField label={t('fields.name')}>
                <Input
                  value={name}
                  onChange={(event) => {
                    saveStatus.clear();
                    setName(event.target.value);
                  }}
                />
              </FormField>
              <FormField label={t('fields.description')}>
                <Textarea
                  value={description}
                  onChange={(event) => {
                    saveStatus.clear();
                    setDescription(event.target.value);
                  }}
                />
              </FormField>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-7">
          <Card>
            <CardHeader>
              {/* Each binding change is its own write, outside the header Save (DEC-08). */}
              <CardTitle>
                {t('sections.bindings')}
                <ImmediateBadge className="align-middle" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BindingsPanel menuId={menu.id} bindings={menu.bindings} onChanged={() => void load({ keepDrafts: true })} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* The tree and the panel that edits its selected item, side by side (Proximity). */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.items')}</CardTitle>
            </CardHeader>
            <CardContent>
              <MenuItemTree
                items={items}
                selectedItemId={selectedItemId}
                onSelect={setSelectedItemId}
                onMove={(itemId, direction) => {
                  saveStatus.clear();
                  setItems((prev) => move(prev, itemId, direction));
                }}
                onDelete={(itemId) => {
                  saveStatus.clear();
                  setItems((prev) => deleteSubtree(prev, itemId));
                }}
                onAddChild={addChild}
              />
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-7">
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
