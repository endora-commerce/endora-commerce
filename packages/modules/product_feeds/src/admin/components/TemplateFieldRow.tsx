import { useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, GripVertical, Info, MoreVertical } from 'lucide-react';
import { Button } from '@endora-commerce/admin-kit/ui';
import { TouchReorderButtons } from '@endora-commerce/admin-kit/components';
import type { ReorderHandleProps, ReorderItemProps } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { TemplatePreviewField } from '../api.js';
import type { DraftField, FieldProblem } from '../template-draft.js';

/**
 * One row of the template's field list — ux-design §3.1.
 *
 * The row is written to read as **one sentence** in the operator's own
 * vocabulary:
 *
 *   `title` — filled from *Product name* — if empty, use "New" — value: `Drill`
 *
 * That is the whole design. No markup, no namespace, no expression language
 * (FR-067, FR-075), and the `←` arrow carries the entire grammar: it ties the
 * name the provider sees to the thing in this shop that fills it.
 *
 * The preview column is the load-bearing part: a merchandiser does not learn
 * what `availability` means from the word, they learn it from `in_stock`
 * sitting next to it, computed from a product they recognise.
 */

export interface TemplateFieldRowProps {
  field: DraftField;
  index: number;
  total: number;
  selected: boolean;
  /** The resolved value for the sample product, when a preview is running. */
  preview: TemplatePreviewField | null;
  previewLoading: boolean;
  /** Whether a sample product has been chosen at all. */
  previewActive: boolean;
  problems: FieldProblem[];
  /** Label for the bound source, already localized ("Product name"). */
  sourceLabel: string;
  gloss: string | null;
  itemProps: ReorderItemProps;
  handleProps: ReorderHandleProps;
  dragging: boolean;
  dropTarget: boolean;
  reorderDisabled: boolean;
  disabled: boolean;
  disabledTitle?: string | undefined;
  onSelect: () => void;
  onMove: (delta: number) => void;
  onMoveTo: (index: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

export function TemplateFieldRow(props: TemplateFieldRowProps): ReactNode {
  const {
    field,
    index,
    total,
    selected,
    preview,
    previewLoading,
    previewActive,
    problems,
    sourceLabel,
    gloss,
    itemProps,
    handleProps,
    dragging,
    dropTarget,
    reorderDisabled,
    disabled,
    disabledTitle,
  } = props;
  const t = useTranslation('product_feeds');
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveToOpen, setMoveToOpen] = useState(false);
  const [moveToValue, setMoveToValue] = useState(String(index + 1));

  const needsAttention = problems.length > 0 || field.unbound;

  return (
    <li
      {...itemProps}
      aria-selected={selected}
      className={[
        'flex items-start gap-2 border-b border-border px-2 py-2 text-sm last:border-b-0',
        selected ? 'border-l-2 border-l-primary bg-accent/40' : 'border-l-2 border-l-transparent',
        dragging ? 'opacity-50' : '',
        // A 2 px rule, not a tint: a colour change alone on the target row would
        // not meet the non-text contrast floor.
        dropTarget ? 'border-t-2 border-t-primary' : '',
      ].join(' ')}
      data-testid={`template-field-${field.outputName}`}
    >
      <button
        {...handleProps}
        disabled={reorderDisabled}
        className="mt-0.5 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-40"
        title={reorderDisabled ? t('builder.help.filterBlocksReorder') : undefined}
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>

      <span className="mt-1 w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
        {index + 1}
      </span>

      <button
        type="button"
        tabIndex={-1}
        onClick={props.onSelect}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate font-medium">{field.outputName}</span>
        {gloss ? (
          <span className="block truncate text-xs text-muted-foreground">{gloss}</span>
        ) : null}
      </button>

      <span className="hidden min-w-0 flex-1 flex-col sm:flex">
        {needsAttention ? (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle size={12} aria-hidden="true" />
            {t('builder.field.notFilled')}
          </span>
        ) : (
          <span className="truncate text-xs text-muted-foreground">
            <ArrowRight size={12} className="mr-1 inline" aria-hidden="true" />
            {sourceLabel}
          </span>
        )}
        {field.fallbackValue ? (
          <span className="truncate text-xs text-muted-foreground">
            {t('builder.field.fallback', { value: field.fallbackValue })}
          </span>
        ) : null}
        {field.providerRequired ? (
          <span className="text-xs text-muted-foreground">{t('builder.field.required')}</span>
        ) : null}
      </span>

      {previewActive ? (
        <span className="hidden min-w-0 flex-1 md:block" aria-busy={previewLoading}>
          {previewLoading ? (
            <span className="block h-4 w-24 animate-pulse rounded bg-muted" />
          ) : (
            <PreviewValue field={field} preview={preview} />
          )}
        </span>
      ) : null}

      <span className="flex shrink-0 items-center gap-1">
        <TouchReorderButtons
          onMoveUp={(): void => props.onMove(-1)}
          onMoveDown={(): void => props.onMove(1)}
          disableUp={index === 0}
          disableDown={index === total - 1}
          disabled={reorderDisabled}
        />
        <span className="relative">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tabIndex={-1}
            disabled={disabled}
            title={disabled ? disabledTitle : undefined}
            aria-label={t('builder.field.menu', { name: field.outputName })}
            aria-expanded={menuOpen}
            onClick={(): void => setMenuOpen((open) => !open)}
          >
            <MoreVertical size={16} aria-hidden="true" />
          </Button>
          {menuOpen ? (
            <span className="absolute right-0 top-full z-20 mt-1 flex w-52 flex-col rounded-md border border-border bg-background p-1 shadow-md">
              <button
                type="button"
                className="rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={(): void => {
                  setMenuOpen(false);
                  props.onDuplicate();
                }}
              >
                {t('builder.field.duplicate')}
              </button>
              <button
                type="button"
                className="rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                disabled={reorderDisabled}
                onClick={(): void => {
                  setMenuOpen(false);
                  setMoveToOpen(true);
                }}
              >
                {t('builder.field.moveTo')}
              </button>
              <span className="my-1 border-t border-border" />
              <button
                type="button"
                className="rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-accent"
                onClick={(): void => {
                  setMenuOpen(false);
                  props.onRemove();
                }}
              >
                {t('builder.field.remove')}
              </button>
            </span>
          ) : null}
          {moveToOpen ? (
            /* The answer for a 60-field template: dragging across a scrolling
               viewport is not one, and neither is thirty arrow presses. */
            <span className="absolute right-0 top-full z-20 mt-1 flex w-56 flex-col gap-2 rounded-md border border-border bg-background p-2 shadow-md">
              <label className="text-xs text-muted-foreground">
                {t('builder.field.moveToLabel', { total })}
                <input
                  type="number"
                  min={1}
                  max={total}
                  value={moveToValue}
                  onChange={(event): void => setMoveToValue(event.target.value)}
                  className="mt-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                />
              </label>
              <Button
                type="button"
                size="sm"
                onClick={(): void => {
                  const parsed = Number.parseInt(moveToValue, 10);
                  setMoveToOpen(false);
                  if (Number.isFinite(parsed)) props.onMoveTo(parsed - 1);
                }}
              >
                {t('builder.field.moveToApply')}
              </Button>
            </span>
          ) : null}
        </span>
      </span>
    </li>
  );
}

/**
 * The four preview states, each **icon + words** — never colour alone
 * (ux-design §3.4). "Empty" is not a state an operator can act on; "empty, and
 * this product would be left out of the feed" is.
 */
function PreviewValue(props: {
  field: DraftField;
  preview: TemplatePreviewField | null;
}): ReactNode {
  const { field, preview } = props;
  const t = useTranslation('product_feeds');
  if (!preview) return null;

  if (preview.value !== null && preview.resolvedFrom === 'source') {
    return <span className="block truncate text-xs">{preview.value}</span>;
  }
  if (preview.value !== null && preview.resolvedFrom === 'fallback') {
    return (
      <span className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground">
        <ArrowRight size={12} aria-hidden="true" />
        {t('builder.preview.empty.fallback', { fallback: field.fallbackValue ?? preview.value })}
      </span>
    );
  }
  if (preview.wouldSkipItem) {
    return (
      <span className="inline-flex items-center gap-1 truncate text-xs text-destructive">
        <AlertTriangle size={12} aria-hidden="true" />
        {t('builder.preview.empty.skips')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground">
      <Info size={12} aria-hidden="true" />
      {t('builder.preview.empty.omitted')}
    </span>
  );
}
