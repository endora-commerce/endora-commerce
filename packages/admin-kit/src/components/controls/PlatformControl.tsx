/**
 * The platform input controls (`specs/193-admin-form-extensions/`
 * `contracts/input-controls.md` §1, FR-030): the components behind the
 * contracts' `PLATFORM_INPUT_CONTROLS`, each a thin wrapper of a kit input that
 * already exists (Principle IX) — `Input`, `Textarea`, `Select`, `Switch`,
 * `MultiSelect`, `CountrySelect`, `ColorPicker`. The fit of a control to a
 * field (`control-type-mismatch`) was decided at composition; a control here
 * only renders the value it is given and reports the value its output type
 * names. Its own copy is the `core` bundle's.
 *
 * A module's control (`<moduleId>.<name>`) receives the same
 * {@link DeclaredControlProps}, so the two are interchangeable at a field.
 */
import type { ComponentType, ReactNode } from 'react';
import type { PlatformInputControlId } from '@endora-commerce/contracts';

import { useTranslation } from '../../i18n/useTranslation.js';
import { ColorPicker } from '../../ui/color-picker.js';
import type { FormFieldControlProps } from '../../ui/form-field.js';
import { Input } from '../../ui/input.js';
import { MultiSelect } from '../../ui/multi-select.js';
import { Select } from '../../ui/select.js';
import { Switch } from '../../ui/switch.js';
import { Textarea } from '../../ui/textarea.js';
import { CountrySelect } from '../country-select/CountrySelect.js';

/** What a control — the platform's or a module's — receives at a declared field. */
export interface DeclaredControlProps {
  readonly value: unknown;
  /** `undefined` clears the value. */
  readonly onChange: (next: unknown) => void;
  /** The wiring `FormField` puts on its control: spread it onto the input. */
  readonly control: FormFieldControlProps;
  readonly readOnly: boolean;
  /** The field's accessible name as text — a fallback for {@link labelledBy}. */
  readonly label: string;
  /**
   * The id of the field's visible label text, for a control whose trigger is
   * not the element the label points at: name it by reference, so a label that
   * is not plain text still names it.
   */
  readonly labelledBy?: string | undefined;
  readonly placeholder?: string | undefined;
  /** For select-like controls: the field's options, already narrowed to the effective `options`. */
  readonly options?: readonly { readonly value: string; readonly label: string }[] | undefined;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value));

/**
 * Each control is a plain component declared at module scope: building them
 * from a factory call would run code at import (#175), which a package that
 * declares `sideEffects: false` must not.
 */
function TextControl({ type, ...props }: DeclaredControlProps & { readonly type: 'text' | 'email' | 'tel' | 'url' | 'date' }): ReactNode {
  return (
    <Input
      {...props.control}
      type={type}
      value={text(props.value)}
      readOnly={props.readOnly}
      {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
      onChange={(event): void => props.onChange(event.target.value === '' ? undefined : event.target.value)}
    />
  );
}

function NumberControl({ step, ...props }: DeclaredControlProps & { readonly step: 'any' | '1' }): ReactNode {
  return (
    <Input
      {...props.control}
      type="number"
      step={step}
      inputMode={step === '1' ? 'numeric' : 'decimal'}
      value={typeof props.value === 'number' || typeof props.value === 'string' ? String(props.value) : ''}
      readOnly={props.readOnly}
      {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
      onChange={(event): void => {
        const next = event.target.valueAsNumber;
        props.onChange(Number.isFinite(next) ? next : undefined);
      }}
    />
  );
}

function PlainTextControl(props: DeclaredControlProps): ReactNode {
  return <TextControl {...props} type="text" />;
}
function EmailControl(props: DeclaredControlProps): ReactNode {
  return <TextControl {...props} type="email" />;
}
function TelControl(props: DeclaredControlProps): ReactNode {
  return <TextControl {...props} type="tel" />;
}
function UrlControl(props: DeclaredControlProps): ReactNode {
  return <TextControl {...props} type="url" />;
}
function DateControl(props: DeclaredControlProps): ReactNode {
  return <TextControl {...props} type="date" />;
}
function DecimalControl(props: DeclaredControlProps): ReactNode {
  return <NumberControl {...props} step="any" />;
}
function IntegerControl(props: DeclaredControlProps): ReactNode {
  return <NumberControl {...props} step="1" />;
}

function TextareaControl(props: DeclaredControlProps): ReactNode {
  return (
    <Textarea
      {...props.control}
      value={text(props.value)}
      readOnly={props.readOnly}
      {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
      onChange={(event): void => props.onChange(event.target.value === '' ? undefined : event.target.value)}
    />
  );
}

function SwitchControl(props: DeclaredControlProps): ReactNode {
  return (
    <Switch
      {...props.control}
      checked={props.value === true}
      disabled={props.readOnly}
      onCheckedChange={(next): void => props.onChange(next)}
    />
  );
}

function SelectControl(props: DeclaredControlProps): ReactNode {
  const t = useTranslation('core');
  return (
    <Select
      {...props.control}
      value={text(props.value)}
      disabled={props.readOnly}
      onChange={(event): void => props.onChange(event.target.value === '' ? undefined : event.target.value)}
    >
      <option value="">{props.placeholder ?? t('declaredForm.control.choose')}</option>
      {(props.options ?? []).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}

function MultiSelectControl(props: DeclaredControlProps): ReactNode {
  const t = useTranslation('core');
  const selected = Array.isArray(props.value) ? props.value.filter((entry): entry is string => typeof entry === 'string') : [];
  return (
    <MultiSelect
      id={props.control.id}
      {...(props.labelledBy === undefined ? { ariaLabel: props.label } : { ariaLabelledBy: props.labelledBy })}
      options={(props.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
      selected={selected}
      disabled={props.readOnly}
      placeholder={props.placeholder ?? t('declaredForm.control.choose')}
      onChange={(next): void => props.onChange(next.length === 0 ? undefined : next)}
    />
  );
}

function CountryControl(props: DeclaredControlProps): ReactNode {
  return (
    <CountrySelect
      id={props.control.id}
      {...(props.control['aria-describedby'] === undefined ? {} : { ariaDescribedBy: props.control['aria-describedby'] })}
      {...(props.control['aria-invalid'] === true ? { invalid: true } : {})}
      value={typeof props.value === 'string' && props.value !== '' ? props.value : null}
      disabled={props.readOnly}
      clearable
      {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
      onChange={(next): void => props.onChange(next ?? undefined)}
    />
  );
}

/** A swatch trigger and a popover: no single labellable element, so its field is a group. */
function ColorControl(props: DeclaredControlProps): ReactNode {
  const t = useTranslation('core');
  return (
    <ColorPicker
      value={text(props.value)}
      label={props.label}
      {...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy })}
      customLabel={t('declaredForm.control.customColor')}
      disabled={props.readOnly}
      onChange={(next): void => props.onChange(next)}
    />
  );
}

/** One component per platform control id (`PLATFORM_INPUT_CONTROLS`). */
export const PLATFORM_CONTROL_COMPONENTS: Readonly<Record<PlatformInputControlId, ComponentType<DeclaredControlProps>>> = {
  'platform.text': PlainTextControl,
  'platform.textarea': TextareaControl,
  'platform.email': EmailControl,
  'platform.tel': TelControl,
  'platform.url': UrlControl,
  'platform.number': DecimalControl,
  'platform.integer': IntegerControl,
  'platform.decimal': DecimalControl,
  'platform.switch': SwitchControl,
  'platform.select': SelectControl,
  'platform.multiselect': MultiSelectControl,
  'platform.date': DateControl,
  'platform.country': CountryControl,
  'platform.color': ColorControl,
};

/**
 * The controls whose field is a `FormField` group: a trigger and a popover, no
 * single element that takes the label's `for` and the field's descriptions. The
 * group is named by the label and described by the hint and the error; the
 * trigger is named by the label by reference ({@link DeclaredControlProps.labelledBy}).
 */
export const PLATFORM_GROUP_CONTROLS: ReadonlySet<PlatformInputControlId> = new Set(['platform.multiselect', 'platform.color']);

/** Whether `id` names a platform control. */
export function isPlatformControlId(id: string): id is PlatformInputControlId {
  return Object.prototype.hasOwnProperty.call(PLATFORM_CONTROL_COMPONENTS, id);
}

/** Render the platform control `id` — a field's `control` override. */
export function PlatformControl({ id, ...props }: DeclaredControlProps & { readonly id: PlatformInputControlId }): ReactNode {
  const Component = PLATFORM_CONTROL_COMPONENTS[id];
  return <Component {...props} />;
}
