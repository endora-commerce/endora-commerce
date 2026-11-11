import type { ReactNode } from 'react';
import type { InputSurfaceField } from '@endora-commerce/contracts';
import type { tForLocale } from '../../lib/i18n/messages';
import {
  customFieldName,
  type RegisterCustomFieldGroups,
  type RegisterCustomFieldValue,
  type RegisterFieldError,
} from '../../lib/auth/register-form-state';

type Translate = ReturnType<typeof tForLocale>;

/**
 * Feature 175 — the custom fields an administrator opened on
 * `organization.register`, rendered generically for one registration group
 * (`specs/175-buyer-input-custom-fields/` research R-10, FR-031, FR-032).
 *
 * One control per value type: text → a text input; number → a text input with
 * the decimal keypad (a spinner steps by one and loses a decimal comma); date →
 * a date input; boolean → a checkbox after a hidden `false`, so an unticked box
 * is sent as `false` (spec edge case) — and therefore neither marked nor
 * `required`, since `false` is an answer; single choice → radio buttons for up
 * to four options (every option visible at once, Hick's law), a `<select>` for
 * more; multiple choice → a checkbox group. A group is a `<fieldset>` named by
 * its `<legend>`.
 *
 * Names are `cf.organization.<key>` / `cf.customer.<key>`; the action reads
 * them back against the same field list. Every control is uncontrolled and
 * seeded from the state, so a refusal returned without JavaScript comes back
 * as typed and one returned with it leaves the typed DOM alone. A refusal is
 * said under its field, tied to it with `aria-describedby` and
 * `aria-invalid`; a refusal of the whole group, or of a field this form does
 * not show, is said at the top of the section.
 */

/** A radio group up to this many options, a `<select>` above it. */
const RADIO_MAX = 4;
/** The longest text the backend accepts from a buyer (FR-013). */
const TEXT_MAX = 1000;

/**
 * What the buyer reads for a refusal: the backend's sentence, which it worded in
 * the request's language (`specs/conventions/module-i18n.md`, case 1 — the code
 * travels beside it for a consumer to branch on, never to re-word). A refusal
 * that arrived with no sentence gets the generic one.
 */
export function customFieldErrorText(t: Translate, error: RegisterFieldError): string {
  return error.message.trim() !== '' ? error.message : t('auth.register.customFields.error.invalid');
}

export function CustomFieldInputs({
  group,
  errorPrefix,
  legend,
  fields,
  values,
  errors,
  t,
}: {
  group: keyof RegisterCustomFieldGroups;
  /** How the backend names this group in a refusal: `organization` or `firstUser`. */
  errorPrefix: 'organization' | 'firstUser';
  legend: string;
  fields: readonly InputSurfaceField[];
  values: Readonly<Record<string, RegisterCustomFieldValue>>;
  errors: Readonly<Record<string, RegisterFieldError>>;
  t: Translate;
}): ReactNode {
  const shown = new Set(fields.map((field) => `${errorPrefix}.${field.key}`));
  const sectionErrors = Object.entries(errors)
    .filter(([name]) => name === errorPrefix || (name.startsWith(`${errorPrefix}.`) && !shown.has(name)))
    .map(([name, error]) => ({ name, text: customFieldErrorText(t, error) }));
  if (fields.length === 0 && sectionErrors.length === 0) return null;

  return (
    <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
      <legend style={{ fontWeight: 600 }}>{legend}</legend>
      {sectionErrors.map((error) => (
        <p key={error.name} className="b2b-auth__error m-0">
          {error.text}
        </p>
      ))}
      {fields.map((field) => (
        <CustomFieldControl
          key={field.key}
          id={`cf-${group}-${field.key}`}
          name={customFieldName(group, field.key)}
          field={field}
          value={values[field.key]}
          error={errors[`${errorPrefix}.${field.key}`]}
          t={t}
        />
      ))}
    </fieldset>
  );
}

function RequiredMark({ t, spoken }: { t: Translate; spoken: boolean }): ReactNode {
  return (
    <>
      <span aria-hidden="true"> *</span>
      {/* An input says "required" through its attribute; a group has none, so it says it in text. */}
      {spoken ? <span className="sr-only"> {t('auth.register.customFields.required')}</span> : null}
    </>
  );
}

function CustomFieldControl({
  id,
  name,
  field,
  value,
  error,
  t,
}: {
  id: string;
  name: string;
  field: InputSurfaceField;
  value: RegisterCustomFieldValue | undefined;
  error: RegisterFieldError | undefined;
  t: Translate;
}): ReactNode {
  const errorId = `${id}-error`;
  const invalid = error ? { 'aria-invalid': true as const, 'aria-describedby': errorId } : {};
  const note = error ? (
    <p id={errorId} className="b2b-auth__error m-0">
      {customFieldErrorText(t, error)}
    </p>
  ) : null;
  const text = typeof value === 'string' ? value : '';

  switch (field.valueType) {
    case 'boolean':
      return (
        <div className="b2b-auth__field">
          <div className="flex items-center gap-2">
            <input type="hidden" name={name} value="false" />
            <input id={id} type="checkbox" name={name} value="true" defaultChecked={value === true} {...invalid} />
            <label htmlFor={id}>{field.label}</label>
          </div>
          {note}
        </div>
      );
    case 'multiselect': {
      const ticked = new Set(Array.isArray(value) ? value : []);
      return (
        <fieldset className="b2b-auth__field" style={{ border: 0, padding: 0 }}>
          <legend>
            {field.label}
            {field.required ? <RequiredMark t={t} spoken /> : null}
          </legend>
          {field.options.map((option) => (
            <div key={option.value} className="flex items-center gap-2">
              <input
                id={`${id}-${option.value}`}
                type="checkbox"
                name={name}
                value={option.value}
                defaultChecked={ticked.has(option.value)}
                {...invalid}
              />
              <label htmlFor={`${id}-${option.value}`}>{option.label}</label>
            </div>
          ))}
          {note}
        </fieldset>
      );
    }
    case 'select':
      if (field.options.length <= RADIO_MAX) {
        return (
          <fieldset className="b2b-auth__field" style={{ border: 0, padding: 0 }}>
            <legend>
              {field.label}
              {field.required ? <RequiredMark t={t} spoken /> : null}
            </legend>
            {field.options.map((option) => (
              <div key={option.value} className="flex items-center gap-2">
                <input
                  id={`${id}-${option.value}`}
                  type="radio"
                  name={name}
                  value={option.value}
                  required={field.required}
                  defaultChecked={text === option.value}
                  {...invalid}
                />
                <label htmlFor={`${id}-${option.value}`}>{option.label}</label>
              </div>
            ))}
            {note}
          </fieldset>
        );
      }
      return (
        <div className="b2b-auth__field">
          <label htmlFor={id}>
            {field.label}
            {field.required ? <RequiredMark t={t} spoken={false} /> : null}
          </label>
          <select id={id} name={name} required={field.required} defaultValue={text} {...invalid}>
            <option value="">{t('auth.register.customFields.choose')}</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {note}
        </div>
      );
    default:
      // text, number, date
      return (
        <div className="b2b-auth__field">
          <label htmlFor={id}>
            {field.label}
            {field.required ? <RequiredMark t={t} spoken={false} /> : null}
          </label>
          <input
            id={id}
            name={name}
            type={field.valueType === 'date' ? 'date' : 'text'}
            {...(field.valueType === 'number' ? { inputMode: 'decimal' as const } : {})}
            {...(field.valueType === 'text' ? { maxLength: TEXT_MAX } : {})}
            required={field.required}
            placeholder=" "
            defaultValue={text}
            {...invalid}
          />
          {note}
        </div>
      );
  }
}
