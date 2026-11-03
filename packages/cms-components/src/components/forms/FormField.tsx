'use client';

import type { ReactNode } from 'react';
import type { FormAddressPart, PublicFormField } from '@endora-commerce/contracts';
import { FORM_ADDRESS_PARTS } from '@endora-commerce/contracts';
import type { CmsFormsText } from '../render-context.js';
import { sanitizeRichHtml } from '../rich-content-shared.js';
import { ErrorIcon } from './FormErrorSummary.js';

/**
 * One element of a `forms.Form` section (`specs/170-forms-module/` research R-28, FR-069): every
 * input has a `<label for>`, `aria-required` when required, `aria-describedby` pointing at its help
 * and its error; radio and checkbox groups and an address sit in a `<fieldset>` with a `<legend>`;
 * dates and times are native inputs; rich texts go through `sanitizeRichHtml` only.
 *
 * `required` is announced, not enforced by the browser: the form is `noValidate` and the server is
 * the authority (FR-034), so a shopper without JavaScript gets the server's messages, not the
 * browser's.
 */

type InputField = Exclude<PublicFormField, { type: 'content' | 'section_break' | 'hidden' }>;

export interface FormFieldProps {
  field: Exclude<PublicFormField, { type: 'hidden' }>;
  /** The element id of the control (the first one of a group). */
  domId: string;
  text: CmsFormsText;
  /** The dictionary's countries in the page language; empty in the editor. */
  countries: readonly { code: string; label: string }[];
  /** An error message to show under the field, by field key or `<key>.<part>`. */
  errors?: Readonly<Record<string, string>>;
  /**
   * A refused no-JS attempt's posted values, by field key or `<key>.<part>` (research R-10). When
   * present they replace every default — an absent key is an answer left empty or unticked.
   */
  values?: Readonly<Record<string, string | readonly string[]>> | undefined;
}

/** The posted value as one string (the first of a repeated name). */
function postedText(values: FormFieldProps['values'], key: string): string | undefined {
  if (values === undefined) return undefined;
  const value = values[key];
  if (value === undefined) return '';
  return typeof value === 'string' ? value : (value[0] ?? '');
}

/** The posted values as a list. */
function postedList(values: FormFieldProps['values'], key: string): readonly string[] | undefined {
  if (values === undefined) return undefined;
  const value = values[key];
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

const CONSENT_TYPES = new Set(['privacy_consent', 'marketing_consent', 'terms']);

function RequiredMarker({ text }: { text: CmsFormsText }): ReactNode {
  return (
    <span className="cmsc-pb-form__req">
      <span aria-hidden="true">*</span>
      <span className="cmsc-sr-only">{text.required}</span>
    </span>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }): ReactNode {
  if (!message) return null;
  return (
    <p id={id} className="cmsc-pb-form__error">
      <ErrorIcon />
      {message}
    </p>
  );
}

/** `aria-describedby` from the ids that exist, or nothing. */
function describedBy(...ids: (string | false | undefined)[]): { 'aria-describedby'?: string } {
  const present = ids.filter((id): id is string => typeof id === 'string' && id !== '');
  return present.length > 0 ? { 'aria-describedby': present.join(' ') } : {};
}

/** A checkbox is not drawn as a text control. */
function withoutClass<T extends { className?: string }>(control: T): Omit<T, 'className'> {
  const { className: _className, ...rest } = control;
  return rest;
}

/** A consent's or a content element's rich text, sanitised. */
function Rich({ html, className }: { html: string; className: string }): ReactNode {
  return <span className={className} dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(html) }} />;
}

export function FormField({ field, domId, text, countries, errors = {}, values }: FormFieldProps): ReactNode {
  if (field.type === 'content') return <Rich html={field.content} className="cmsc-pb-form__content" />;
  if (field.type === 'section_break') return <h4 className="cmsc-pb-form__break">{field.title}</h4>;
  return <InputControl field={field} domId={domId} text={text} countries={countries} errors={errors} values={values} />;
}

function InputControl({
  field,
  domId,
  text,
  countries,
  errors,
  values,
}: Omit<FormFieldProps, 'field' | 'errors'> & { field: InputField; errors: Readonly<Record<string, string>> }): ReactNode {
  const posted = postedText(values, field.key);
  const postedValues = postedList(values, field.key);
  const initial = (fallback: string | number | undefined) =>
    posted !== undefined ? { defaultValue: posted } : fallback !== undefined ? { defaultValue: fallback } : {};
  const helpId = field.help ? `${domId}-help` : undefined;
  const errorId = `${domId}-error`;
  const error = errors[field.key];
  const consent = CONSENT_TYPES.has(field.type);
  // Privacy and terms are always required when shown; marketing never (FR-029).
  const required = consent ? field.type !== 'marketing_consent' : field.required;
  const help = helpId ? (
    <p id={helpId} className="cmsc-pb-form__help">
      {field.help}
    </p>
  ) : null;
  const control = {
    id: domId,
    name: field.key,
    className: 'cmsc-pb-form__control',
    ...(required ? { 'aria-required': true as const } : {}),
    ...(error ? { 'aria-invalid': true as const } : {}),
    ...describedBy(helpId, error && errorId),
  };
  const label = (
    <label htmlFor={domId} className="cmsc-pb-form__label">
      {field.label}
      {required ? <RequiredMarker text={text} /> : null}
    </label>
  );
  const placeholder = field.placeholder ? { placeholder: field.placeholder } : {};

  switch (field.type) {
    case 'text':
    case 'email':
    case 'phone':
      return (
        <div className="cmsc-pb-form__field">
          {label}
          <input
            {...control}
            {...placeholder}
            type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
            {...(field.type === 'email' ? { autoComplete: 'email' } : field.type === 'phone' ? { autoComplete: 'tel' } : {})}
            {...(field.type === 'text' && field.maxLength !== undefined ? { maxLength: field.maxLength } : {})}
            {...(field.type === 'text' && field.minLength !== undefined ? { minLength: field.minLength } : {})}
            {...initial(field.defaultValue)}
          />
          {help}
          <FieldError id={errorId} message={error} />
        </div>
      );
    case 'number':
      return (
        <div className="cmsc-pb-form__field">
          {label}
          <input
            {...control}
            {...placeholder}
            type="number"
            inputMode="decimal"
            {...(field.min !== undefined ? { min: field.min } : {})}
            {...(field.max !== undefined ? { max: field.max } : {})}
            {...(field.step !== undefined ? { step: field.step } : {})}
            {...initial(field.defaultValue)}
          />
          {help}
          <FieldError id={errorId} message={error} />
        </div>
      );
    case 'textarea':
      return (
        <div className="cmsc-pb-form__field">
          {label}
          <textarea
            {...control}
            {...placeholder}
            rows={5}
            {...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {})}
            {...(field.minLength !== undefined ? { minLength: field.minLength } : {})}
            {...initial(field.defaultValue)}
          />
          {help}
          <FieldError id={errorId} message={error} />
        </div>
      );
    case 'datetime':
      return (
        <div className="cmsc-pb-form__field">
          {label}
          <input
            {...control}
            type={field.mode === 'datetime' ? 'datetime-local' : field.mode}
            {...(field.earliest !== undefined ? { min: field.earliest } : {})}
            {...(field.latest !== undefined ? { max: field.latest } : {})}
            {...initial(undefined)}
          />
          {help}
          <FieldError id={errorId} message={error} />
        </div>
      );
    case 'select':
      return (
        <div className="cmsc-pb-form__field">
          {label}
          <select {...control} defaultValue={posted ?? field.defaultValue ?? ''}>
            <option value="">{field.placeholder ?? text.selectPlaceholder}</option>
            {field.options.map((option) => (
              <option key={option.id} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {help}
          <FieldError id={errorId} message={error} />
        </div>
      );
    case 'country':
      return (
        <div className="cmsc-pb-form__field">
          {label}
          <CountrySelect
            control={control}
            countries={countries}
            allowed={field.allowedCountries}
            defaultValue={posted ?? field.defaultValue}
            placeholder={field.placeholder ?? text.countryPlaceholder}
          />
          {help}
          <FieldError id={errorId} message={error} />
        </div>
      );
    case 'radio':
    case 'checkboxes':
      return (
        <fieldset
          className="cmsc-pb-form__group"
          {...(field.type === 'radio' ? { role: 'radiogroup' } : {})}
          {...(field.type === 'radio' && required ? { 'aria-required': true as const } : {})}
          {...(error ? { 'aria-invalid': true as const } : {})}
          {...describedBy(helpId, error && errorId)}
        >
          <legend className="cmsc-pb-form__label">
            {field.label}
            {required ? <RequiredMarker text={text} /> : null}
          </legend>
          {field.options.map((option, index) => {
            const optionId = index === 0 ? domId : `${domId}-${option.id}`;
            const checked =
              postedValues !== undefined
                ? postedValues.includes(option.value)
                : field.type === 'radio'
                  ? field.defaultValue === option.value
                  : (field.defaultValue ?? []).includes(option.value);
            return (
              <div key={option.id} className="cmsc-pb-form__check">
                <input
                  id={optionId}
                  type={field.type === 'radio' ? 'radio' : 'checkbox'}
                  name={field.key}
                  value={option.value}
                  defaultChecked={checked}
                />
                <label htmlFor={optionId}>{option.label}</label>
              </div>
            );
          })}
          {help}
          <FieldError id={errorId} message={error} />
        </fieldset>
      );
    case 'checkbox':
      return (
        <div className="cmsc-pb-form__check">
          <input
            {...withoutClass(control)}
            type="checkbox"
            value="on"
            defaultChecked={posted !== undefined ? posted === 'on' : field.defaultChecked === true}
          />
          <label htmlFor={domId}>
            {field.label}
            {required ? <RequiredMarker text={text} /> : null}
          </label>
          {help}
          <FieldError id={errorId} message={error} />
        </div>
      );
    case 'privacy_consent':
    case 'marketing_consent':
    case 'terms':
      // Never pre-ticked (FR-029): the definition has no default to set.
      return (
        <div className="cmsc-pb-form__check cmsc-pb-form__check--consent">
          <input {...withoutClass(control)} type="checkbox" value="on" defaultChecked={posted === 'on'} />
          <label htmlFor={domId}>
            <Rich html={field.content || field.label} className="cmsc-pb-form__consent-text" />
            {required ? <RequiredMarker text={text} /> : null}
          </label>
          {help}
          <FieldError id={errorId} message={error} />
        </div>
      );
    case 'address':
      return (
        <fieldset className="cmsc-pb-form__group cmsc-pb-form__group--address" {...describedBy(helpId)}>
          <legend className="cmsc-pb-form__label">
            {field.label}
            {required ? <RequiredMarker text={text} /> : null}
          </legend>
          <div className="cmsc-pb-form__parts">
            {FORM_ADDRESS_PARTS.filter((part) => field.parts[part].enabled).map((part) => (
              <AddressPart
                key={part}
                part={part}
                field={field}
                domId={`${domId}-${part}`}
                text={text}
                countries={countries}
                error={errors[`${field.key}.${part}`]}
                value={postedText(values, `${field.key}.${part}`)}
              />
            ))}
          </div>
          {help}
        </fieldset>
      );
  }
}

function AddressPart({
  part,
  field,
  domId,
  text,
  countries,
  error,
  value,
}: {
  part: FormAddressPart;
  field: Extract<PublicFormField, { type: 'address' }>;
  domId: string;
  text: CmsFormsText;
  countries: readonly { code: string; label: string }[];
  error: string | undefined;
  value: string | undefined;
}): ReactNode {
  const settings = field.parts[part];
  const required = field.required && settings.required;
  const errorId = `${domId}-error`;
  const control = {
    id: domId,
    name: `${field.key}.${part}`,
    className: 'cmsc-pb-form__control',
    ...(required ? { 'aria-required': true as const } : {}),
    ...(error ? { 'aria-invalid': true as const } : {}),
    ...describedBy(error && errorId),
  };
  return (
    <div className={`cmsc-pb-form__part cmsc-pb-form__part--${part}`}>
      <label htmlFor={domId} className="cmsc-pb-form__label">
        {settings.label || text.addressParts[part]}
        {required ? <RequiredMarker text={text} /> : null}
      </label>
      {part === 'country' ? (
        <CountrySelect control={control} countries={countries} placeholder={text.countryPlaceholder} defaultValue={value} />
      ) : (
        <input
          {...control}
          type="text"
          {...(value !== undefined ? { defaultValue: value } : {})}
          autoComplete={
            part === 'street' ? 'address-line1' : part === 'line2' ? 'address-line2' : part === 'city' ? 'address-level2' : 'postal-code'
          }
        />
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function CountrySelect({
  control,
  countries,
  allowed,
  defaultValue,
  placeholder,
}: {
  control: Record<string, unknown>;
  countries: readonly { code: string; label: string }[];
  allowed?: readonly string[] | undefined;
  defaultValue?: string | undefined;
  placeholder: string;
}): ReactNode {
  // In the editor there is no dictionary: the allowed codes stand for themselves.
  const source = countries.length > 0 ? countries : (allowed ?? []).map((code) => ({ code, label: code }));
  const options = allowed ? source.filter((country) => allowed.includes(country.code)) : source;
  return (
    <select {...control} autoComplete="country" defaultValue={defaultValue ?? ''}>
      <option value="">{placeholder}</option>
      {options.map((country) => (
        <option key={country.code} value={country.code}>
          {country.label}
        </option>
      ))}
    </select>
  );
}
