import type { DragEvent, ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { FORM_FIELD_TYPES, type FormFieldType } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@endora-commerce/admin-kit/ui';
import { FIELD_TYPE_DRAG_FORMAT } from '../lib/definition-draft.js';
import { FIELD_TYPE_ICONS } from '../lib/field-icons.js';

/**
 * The field palette of the builder (`specs/170-forms-module/` FR-015, research R-19): every field
 * type, each a button that is dragged onto a section or pressed to add it to the section being
 * edited. The keyboard has a second path that needs no pointer at all — each section's own
 * *Add field* menu (`BuilderCanvas`) — so dragging is never the only way in (WCAG 2.5.7).
 *
 * While the builder edits another content language than the form's default, the structure is
 * locked (User Story 7): the palette then says so instead of offering field types.
 */
export interface FieldPaletteProps {
  readonly onAdd: (type: FormFieldType) => void;
  readonly disabled?: boolean;
  /** Set while another language than the default is edited: the default language's name. */
  readonly lockedFor?: string | null;
}

export function FieldPalette({ onAdd, disabled = false, lockedFor = null }: FieldPaletteProps): ReactNode {
  const t = useTranslation('forms');
  const onDragStart = (type: FormFieldType) => (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData(FIELD_TYPE_DRAG_FORMAT, type);
    event.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <Card role="region" aria-labelledby="forms-palette-title" className="lg:sticky lg:top-4">
      <CardHeader className="p-4 pb-2">
        <CardTitle>
          <h2 id="forms-palette-title">{t('palette.title')}</h2>
        </CardTitle>
        {lockedFor === null ? <CardDescription className="text-xs">{t('palette.hint')}</CardDescription> : null}
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {lockedFor !== null ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Lock size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{t('language.lockedShort', { language: lockedFor })}</span>
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-1">
            {FORM_FIELD_TYPES.map((type) => {
              const Icon = FIELD_TYPE_ICONS[type];
              return (
                <li key={type}>
                  <button
                    type="button"
                    draggable={!disabled}
                    disabled={disabled}
                    onDragStart={onDragStart(type)}
                    onClick={() => onAdd(type)}
                    aria-label={t('palette.add', { type: t(`fieldTypes.${type}`) })}
                    className="flex min-h-9 w-full cursor-grab items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-left text-sm transition-colors hover:border-primary/50 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Icon size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                    <span className="truncate">{t(`fieldTypes.${type}`)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
