import { useId, useMemo, type ReactNode } from 'react';
import type { DocumentFieldDefinition } from '@endora-commerce/contracts';
import { ReorderAnnouncer, TouchReorderButtons, useReorderList, type ReorderLabels } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/** A stored list entry, as Puck hands it back: untrusted, so every reader has a fallback. */
export type Entry = Record<string, unknown>;

export const asList = (value: unknown): Entry[] =>
  Array.isArray(value) ? value.filter((v): v is Entry => v !== null && typeof v === 'object' && !Array.isArray(v)) : [];
export const asRecord = (value: unknown): Entry =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Entry) : {};
export const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
export const opOf = (rule: unknown, fallback: string): string => {
  const op = asRecord(rule)['op'];
  return typeof op === 'string' ? op : fallback;
};

/** A field's name, or *Unknown field* with a warning, for a path the catalogue no longer offers (FR-037). */
export function FieldName({ field, path }: { field: DocumentFieldDefinition | undefined; path: string }): ReactNode {
  const t = useTranslation('document_templates');
  if (field) return <span>{field.label}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-amber-700" title={t('itemsTable.columns.unknownFieldHint')}>
      <span aria-hidden="true">⚠</span>
      {t('itemsTable.columns.unknownField')}
      <span className="sr-only"> ({path}): {t('itemsTable.columns.unknownFieldHint')}</span>
    </span>
  );
}

/**
 * The reorder affordances of one list — move up / move down buttons per row,
 * keyboard reachable, every move announced through a live region mounted for
 * the list's lifetime (`useReorderList`, `TouchReorderButtons`, `ReorderAnnouncer`).
 */
export function useListReorder(
  items: Entry[],
  labelOf: (item: Entry, index: number) => string,
  onReorder: (next: Entry[]) => void,
  disabled: boolean,
) {
  const t = useTranslation('document_templates');
  const instructionsId = useId();
  const keyed = useMemo(() => items.map((item, index) => ({ item, key: `${index}:${labelOf(item, index)}` })), [items, labelOf]);
  const labels = useMemo<ReorderLabels>(
    () => ({
      grabbed: (c) => t('itemsTable.reorder.grabbed', { ...c }),
      moving: (c) => t('itemsTable.reorder.moving', { ...c }),
      dropped: (c) => t('itemsTable.reorder.dropped', { ...c }),
      cancelled: (c) => t('itemsTable.reorder.cancelled', { ...c }),
      moved: (c) => t('itemsTable.reorder.moved', { ...c }),
      atStart: (c) => t('itemsTable.reorder.atStart', { ...c }),
      atEnd: (c) => t('itemsTable.reorder.atEnd', { ...c }),
      handle: (c) => t('itemsTable.reorder.handle', { ...c }),
    }),
    [t],
  );
  const reorder = useReorderList({
    items: keyed,
    getId: (entry) => entry.key,
    getLabel: (entry) => labelOf(entry.item, keyed.indexOf(entry)),
    onReorder: (next) => onReorder(next.map((entry) => entry.item)),
    labels,
    disabled,
    instructionsId,
  });
  const announcer = (
    <ReorderAnnouncer message={reorder.announcement} instructions={t('itemsTable.reorder.instructions')} instructionsId={instructionsId} />
  );
  const buttons = (index: number): ReactNode => (
    <TouchReorderButtons
      onMoveUp={() => reorder.moveBy(keyed[index]!.key, -1)}
      onMoveDown={() => reorder.moveBy(keyed[index]!.key, 1)}
      disableUp={index === 0}
      disableDown={index === keyed.length - 1}
      disabled={disabled}
    />
  );
  return { announcer, buttons };
}
