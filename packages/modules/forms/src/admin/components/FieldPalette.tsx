import type { DragEvent, ReactNode } from 'react';
import { FORM_FIELD_TYPES, type FormFieldType } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { FIELD_TYPE_DRAG_FORMAT } from '../lib/definition-draft.js';

/**
 * The field palette of the builder (`specs/170-forms-module/` FR-015, research R-19): every field
 * type, each a button that is dragged onto a section or pressed to add it to the section being
 * edited. The keyboard has a second path that needs no pointer at all — each section's own
 * *Add field* menu (`BuilderCanvas`) — so dragging is never the only way in (WCAG 2.5.7).
 */
export interface FieldPaletteProps {
  readonly onAdd: (type: FormFieldType) => void;
  readonly disabled?: boolean;
}

export function FieldPalette({ onAdd, disabled = false }: FieldPaletteProps): ReactNode {
  const t = useTranslation('forms');
  const onDragStart = (type: FormFieldType) => (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData(FIELD_TYPE_DRAG_FORMAT, type);
    event.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <section aria-labelledby="forms-palette-title" className="space-y-2">
      <h2 id="forms-palette-title" className="text-sm font-semibold">
        {t('palette.title')}
      </h2>
      <p className="text-xs text-muted-foreground">{t('palette.hint')}</p>
      <ul className="grid grid-cols-2 gap-1 lg:grid-cols-1">
        {FORM_FIELD_TYPES.map((type) => (
          <li key={type}>
            <button
              type="button"
              draggable={!disabled}
              disabled={disabled}
              onDragStart={onDragStart(type)}
              onClick={() => onAdd(type)}
              aria-label={t('palette.add', { type: t(`fieldTypes.${type}`) })}
              className="flex min-h-9 w-full cursor-grab items-center rounded-md border border-border bg-background px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t(`fieldTypes.${type}`)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
