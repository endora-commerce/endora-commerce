import { useId, useMemo, type ReactNode } from 'react';
import { ReorderAnnouncer } from '@/components/reorder/ReorderAnnouncer';
import { useReorderList, type ReorderLabels } from '@/components/reorder/useReorderList';
import { useTranslation } from '@/i18n/useTranslation';
import type { TemplatePreview } from '../api';
import type { DraftField, FieldProblem } from '../template-draft';
import { TemplateFieldRow } from './TemplateFieldRow';

/**
 * The ordered field list — ux-design §2.7 / §3.5, FR-067–FR-069.
 *
 * A feed is a flat, ordered list of named columns: it has no two-dimensional
 * structure to drag things around in, so the builder is a list, not a canvas.
 * Dragging exists, but only as **one of three** ways to change the order —
 * pointer drag, the touch move buttons, and the handle's keyboard grab mode —
 * all funnelled through one hook and announced through one live region, because
 * a reorder that only works by dragging fails FR-069 and fails every touch user
 * besides.
 *
 * The list is the ARIA composite-widget pattern: one tab stop for the whole
 * list, arrows to move between rows, and every pointer affordance duplicated by
 * a key. 23 fields × 5 controls would otherwise be ~115 tab stops between the
 * search box and the inspector.
 */

export interface TemplateFieldListProps {
  fields: DraftField[];
  selectedFieldId: string | null;
  onSelect: (fieldId: string) => void;
  onChange: (next: DraftField[]) => void;
  onRemove: (fieldId: string) => void;
  onDuplicate: (fieldId: string) => void;
  /** Free-text filter. While it is non-empty, reordering is off (§3.5). */
  search: string;
  preview: TemplatePreview | null;
  previewLoading?: boolean;
  problems: Record<string, FieldProblem[]>;
  /** Labels for each field's bound source, keyed by field id. */
  sourceLabels?: Record<string, string>;
  /** The one-sentence gloss for each field, keyed by field id. */
  glosses?: Record<string, string>;
  disabled: boolean;
  disabledTitle?: string | undefined;
}

export function TemplateFieldList(props: TemplateFieldListProps): ReactNode {
  const {
    fields,
    selectedFieldId,
    onSelect,
    onChange,
    search,
    preview,
    previewLoading = false,
    problems,
    sourceLabels = {},
    glosses = {},
    disabled,
    disabledTitle,
  } = props;
  const t = useTranslation('product_feeds');
  const instructionsId = useId();

  const filtering = search.trim() !== '';
  // Reordering a filtered subset has no unambiguous meaning, and guessing at
  // one is worse than refusing — so every affordance goes off together and the
  // reason is stated in words above the list.
  const reorderDisabled = disabled || filtering;

  const labels = useMemo<ReorderLabels>(
    () => ({
      grabbed: (c) => t('builder.reorder.grabbed', { ...c }),
      moving: (c) => t('builder.reorder.moving', { ...c }),
      dropped: (c) => t('builder.reorder.dropped', { ...c }),
      cancelled: (c) => t('builder.reorder.cancelled', { ...c }),
      moved: (c) => t('builder.reorder.moved', { ...c }),
      atStart: (c) => t('builder.reorder.atStart', { ...c }),
      atEnd: (c) => t('builder.reorder.atEnd', { ...c }),
      handle: (c) => t('builder.field.reorderHandle', { ...c }),
      roleDescription: 'sortable field',
    }),
    [t],
  );

  const reorder = useReorderList<DraftField>({
    items: fields,
    getId: (field) => field.id,
    getLabel: (field) => field.outputName,
    onReorder: onChange,
    labels,
    disabled: reorderDisabled,
    instructionsId,
  });

  const needle = search.trim().toLowerCase();
  const visible = needle === ''
    ? fields
    : fields.filter((field) => field.outputName.toLowerCase().includes(needle));

  const previewByName = useMemo(() => {
    const map = new Map<string, TemplatePreview['fields'][number]>();
    for (const entry of preview?.fields ?? []) map.set(entry.outputName, entry);
    return map;
  }, [preview]);

  return (
    <div className="flex flex-col gap-2">
      {/* Mounted for the editor's lifetime, never conditionally: a live region
          created at the moment of its first message is never announced. */}
      <ReorderAnnouncer
        message={reorder.announcement}
        instructions={t('builder.reorder.instructions')}
        instructionsId={instructionsId}
      />

      {filtering && !disabled ? (
        <p className="b2b-help">{t('builder.help.filterBlocksReorder')}</p>
      ) : null}

      {fields.length === 0 ? (
        <div className="b2b-empty">
          <p className="b2b-empty__title">{t('builder.empty.title')}</p>
          <p className="b2b-empty__sub">{t('builder.empty.subtitle')}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="b2b-empty">
          <p className="b2b-empty__sub">{t('builder.empty.filtered')}</p>
        </div>
      ) : (
        <ul role="list" aria-label={t('builder.list.ariaLabel')} className="rounded-md border border-border">
          {visible.map((field) => {
            const index = fields.indexOf(field);
            return (
              <TemplateFieldRow
                key={field.id}
                field={field}
                index={index}
                total={fields.length}
                selected={field.id === selectedFieldId}
                preview={previewByName.get(field.outputName) ?? null}
                previewLoading={previewLoading}
                previewActive={preview !== null || previewLoading}
                problems={problems[field.id] ?? []}
                sourceLabel={sourceLabels[field.id] ?? field.sourceKind}
                gloss={glosses[field.id] ?? null}
                itemProps={reorder.getItemProps(field, index)}
                handleProps={reorder.getHandleProps(field, index)}
                dragging={reorder.draggingId === field.id}
                dropTarget={reorder.dropTargetId === field.id}
                reorderDisabled={reorderDisabled}
                disabled={disabled}
                disabledTitle={disabledTitle}
                onSelect={(): void => onSelect(field.id)}
                onMove={(delta): void => reorder.moveBy(field.id, delta)}
                onMoveTo={(target): void => reorder.moveTo(field.id, target)}
                onDuplicate={(): void => props.onDuplicate(field.id)}
                onRemove={(): void => props.onRemove(field.id)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
