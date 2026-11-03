import type { ReactNode } from 'react';
import type { FormDefinition } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cn } from '@endora-commerce/admin-kit/lib';
import { Input, Label, Textarea } from '@endora-commerce/admin-kit/ui';
import { setText, textOf } from '../lib/definition-draft.js';

/**
 * One operator text of a form, edited in the builder's **content language**
 * (`specs/170-forms-module/` User Story 7, FR-068; 2026-11-03 owner review, which replaced the
 * *Translations* tab with the language switch in the builder's header).
 *
 * In the default language it is a plain input. In another language it edits that language's text
 * only; while that text is empty the default language's one is its placeholder, and a short hint —
 * tied to the input — says so, because that is what the storefront shows (R-7). Clearing the text
 * removes it (`setText`), so the fallback applies again.
 *
 * Every input carries `data-text-id`, which the builder's *go to the first missing text* focuses.
 */
export interface TranslatableTextProps {
  readonly id: string;
  /** The visible label; omitted when `ariaLabel` names a compact control (an option row). */
  readonly label?: ReactNode;
  readonly ariaLabel?: string;
  readonly definition: FormDefinition;
  /** The content language being edited. */
  readonly language: string;
  readonly defaultLanguage: string;
  readonly textId: string;
  /** A one-line input, or a text area of that many rows. */
  readonly rows?: number;
  readonly maxLength?: number;
  readonly disabled?: boolean;
  /** What stands in when no language has the text — an option's value, a built-in label. */
  readonly placeholder?: string;
  /** Further descriptions of the input (a hint of the caller's), by id. */
  readonly describedBy?: string;
  readonly className?: string;
  readonly onChange: (next: FormDefinition) => void;
}

const nonBlank = (value: string): boolean => value.trim() !== '';

export function TranslatableText(props: TranslatableTextProps): ReactNode {
  const { id, definition, language, defaultLanguage, textId, rows, disabled = false } = props;
  const t = useTranslation('forms');
  const value = textOf(definition, language, textId);
  const original = language === defaultLanguage ? '' : textOf(definition, defaultLanguage, textId);
  const fallsBack = !nonBlank(value) && nonBlank(original);
  const hintId = `${id}-from-default`;
  const describedBy = [props.describedBy, fallsBack ? hintId : null].filter(Boolean).join(' ');
  const placeholder = nonBlank(original) ? original : props.placeholder;

  const common = {
    id,
    value,
    disabled,
    'data-text-id': textId,
    ...(props.maxLength !== undefined ? { maxLength: props.maxLength } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(props.ariaLabel ? { 'aria-label': props.ariaLabel } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  };
  const write = (next: string): void => props.onChange(setText(definition, language, textId, next));

  return (
    <div className={cn('space-y-1', props.className)}>
      {props.label !== undefined ? <Label htmlFor={id}>{props.label}</Label> : null}
      {rows !== undefined ? (
        <Textarea {...common} rows={rows} onChange={(event) => write(event.target.value)} />
      ) : (
        <Input {...common} onChange={(event) => write(event.target.value)} />
      )}
      {fallsBack ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {t('language.fromDefault', { language: defaultLanguage })}
        </p>
      ) : null}
    </div>
  );
}
