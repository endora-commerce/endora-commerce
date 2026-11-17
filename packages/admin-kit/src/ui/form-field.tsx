import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { useTranslation } from '../i18n/useTranslation.js';
import { Label } from './label.js';
import { HelpTip } from './help-tip.js';

/**
 * What `FormField` puts on its control. Spread it onto the element that takes
 * the input — `{(control) => <MyPicker inputProps={control} />}` — when the
 * control is not the field's direct child.
 */
export interface FormFieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

export interface FormFieldProps {
  /** The field's name. Rendered as a `<label>` pointing at the control. */
  label: ReactNode;
  /**
   * The control: one element (`<Input />`, `<Select>`, `<Textarea />`,
   * `<Checkbox />`, any component that forwards `id` and `aria-*` to its input),
   * which `FormField` clones with the wiring; or a function receiving the wiring
   * as {@link FormFieldControlProps}, for a control that needs it somewhere other
   * than its root.
   */
  children: ReactElement | ((control: FormFieldControlProps) => ReactNode);
  /**
   * One line under the control — a format, a unit, a consequence. **Clamped to
   * one line**; the full text stays in `title`. Anything longer belongs in
   * `help`.
   */
  hint?: ReactNode;
  /** A longer explanation behind a ⓘ beside the label (`HelpTip`), not read on every focus. */
  help?: ReactNode;
  /**
   * Text that has to stay on screen above the control and is longer than a hint
   * — a stored-value notice, a read-only reason. Linked like the hint, never
   * clamped. Prefer `hint` + `help`; this exists so a screen whose copy is not
   * yet short (the content rule in `specs/conventions/module-i18n.md`) can still
   * be wired.
   */
  description?: ReactNode;
  /** Validation message. Marks the control `aria-invalid` and is announced politely. */
  error?: ReactNode;
  /** Shows an asterisk and marks the control `aria-required`. Does not set native `required`. */
  required?: boolean;
  /** The control's id. Default: the control's own `id`, else a generated one. */
  id?: string;
  /**
   * The control is a composite with no single labellable element (an address
   * block, an asset picker, a list of inputs). The field becomes a
   * `role="group"` named by the label, and the hint, description and error
   * describe the group.
   */
  group?: boolean;
  /** Inline after the label, outside it — badges, a copy button. Not part of the accessible name. */
  labelAddon?: ReactNode;
  /** At the end of the label line, as in `Section` — a reset, a secondary action. */
  action?: ReactNode;
  /** Ids of further descriptions rendered elsewhere, appended to `aria-describedby`. */
  describedBy?: string;
  className?: string;
}

function joinIds(...ids: (string | false | null | undefined)[]): string | undefined {
  const joined = ids.filter((id): id is string => typeof id === 'string' && id !== '').join(' ');
  return joined === '' ? undefined : joined;
}

/**
 * A label, its control, a one-line hint and an error, wired together — issue
 * #1432 (UX audit 2026-11-17, DS-08).
 *
 * Every id is generated here, so no screen has to remember `htmlFor`,
 * `aria-describedby` and `aria-invalid` by hand (WCAG 2.2 SC 1.3.1, 3.3.1,
 * 3.3.2, 4.1.2):
 *
 * - the label is a `<label for>` the control's id, which also makes a click on
 *   it focus or toggle the control (Fitts's Law — the label is part of the
 *   target);
 * - the control is described by the error, then the hint, then the
 *   description, then whatever it already carried — the error first because it
 *   is what the operator has to act on;
 * - the error region is **always mounted**, empty until there is an error,
 *   because a live region that arrives already carrying its message is not
 *   reliably announced (SC 4.1.3). It pairs the text with an icon, so the state
 *   is never carried by colour alone;
 * - `required` is an asterisk hidden from assistive technology plus
 *   `aria-required` on the control — in `group` mode, where `aria-required` is
 *   not allowed, a visually hidden "(required)" in the label instead.
 *
 * Spacing follows the Law of Proximity: label → control is 6 px, control → hint
 * 4 px, and the field brings no outer margin, so the form's own gap (16 px,
 * `space-y-4`) is what separates one field from the next and is always the
 * larger one.
 *
 * ```tsx
 * <FormField label={t('field.email')} hint={t('field.emailHint')} error={errors.email} required>
 *   <Input type="email" value={email} onChange={…} />
 * </FormField>
 *
 * <FormField label={t('field.owner')}>
 *   {(control) => <AdminUserPicker inputId={control.id} … />}
 * </FormField>
 * ```
 */
export function FormField(props: FormFieldProps): ReactNode {
  const t = useTranslation('core');
  const base = useId();
  const labelId = `${base}-label`;
  const descriptionId = `${base}-description`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;
  const hasError = props.error !== undefined && props.error !== null && props.error !== false;
  const hasHint = props.hint !== undefined && props.hint !== null && props.hint !== false;
  const hasDescription =
    props.description !== undefined && props.description !== null && props.description !== false;

  const describedBy = joinIds(
    hasError && errorId,
    hasHint && hintId,
    hasDescription && descriptionId,
    props.describedBy,
  );

  const element = isValidElement(props.children)
    ? (props.children as ReactElement<{ id?: string; 'aria-describedby'?: string }>)
    : null;
  const controlId = element?.props.id ?? props.id ?? `${base}-control`;
  const group = props.group === true;

  const control: FormFieldControlProps = group
    ? { id: controlId }
    : {
        id: controlId,
        ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
        ...(hasError ? { 'aria-invalid': true as const } : {}),
        ...(props.required ? { 'aria-required': true as const } : {}),
      };

  let renderedControl: ReactNode;
  if (typeof props.children === 'function') {
    renderedControl = props.children(control);
  } else if (group || element === null) {
    renderedControl = props.children;
  } else {
    const merged = joinIds(control['aria-describedby'], element.props['aria-describedby']);
    renderedControl = cloneElement(element, {
      ...control,
      ...(merged === undefined ? {} : { 'aria-describedby': merged }),
    });
  }

  const marker = props.required ? (
    <span aria-hidden="true" className="text-destructive">
      *
    </span>
  ) : null;

  const label = group ? (
    <span id={labelId} className="text-sm font-medium leading-none">
      {props.label}
      {marker ? <> {marker}</> : null}
      {props.required ? <span className="sr-only"> {t('common.formField.required')}</span> : null}
    </span>
  ) : (
    <Label id={labelId} htmlFor={controlId}>
      {props.label}
      {marker ? <> {marker}</> : null}
    </Label>
  );

  const hintTitle = typeof props.hint === 'string' ? props.hint : undefined;

  return (
    <div
      className={cn('min-w-0', props.className)}
      {...(group
        ? { role: 'group', 'aria-labelledby': labelId, 'aria-describedby': describedBy }
        : {})}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          {label}
          {props.help ? <HelpTip subjectId={labelId}>{props.help}</HelpTip> : null}
          {props.labelAddon ?? null}
        </div>
        {props.action ?? null}
      </div>
      {hasDescription ? (
        <div id={descriptionId} className="mb-1.5 space-y-1 text-xs text-muted-foreground">
          {props.description}
        </div>
      ) : null}
      {renderedControl}
      {hasHint ? (
        <p id={hintId} title={hintTitle} className="mt-1 line-clamp-1 text-xs text-muted-foreground">
          {props.hint}
        </p>
      ) : null}
      <p
        id={errorId}
        aria-live="polite"
        className={cn(
          'text-xs font-medium text-destructive',
          hasError && 'mt-1 flex items-start gap-1',
        )}
      >
        {hasError ? (
          <>
            <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{props.error}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
