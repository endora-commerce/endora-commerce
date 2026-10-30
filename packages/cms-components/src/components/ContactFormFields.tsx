import type { Fields } from '@puckeditor/core';
import { createToggleField } from '@endora-commerce/page-builder-core';
import type { ContactFormFieldKey, ContactFormProps } from '../schema/component-types.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { BOX_BORDER_FIELD, BOX_MARGIN_FIELD, BOX_PADDING_FIELD } from '../fields/shared-fields.js';
import { BUTTON_SPEC_OBJECT_FIELDS } from './Button.js';

/**
 * `cms.ContactForm`'s editor fields (`specs/169-page-builder-contact-form/` contracts/blocks.md
 * §4). Content → layout → style → spacing → visibility (feature 163's order); every field
 * object is a module constant, and `resolveFields` hands Puck one cached object per shape it
 * shows (feature 163 R17 — a recreated field loses its input's focus).
 *
 * The span of a field lives in that field's own group because that is where it is stored
 * (`fields.<key>.span`); it is shown only with two columns.
 */

/** The fields the server knows, in render order (data-model §3). */
export const CONTACT_FORM_FIELD_KEYS: readonly ContactFormFieldKey[] = [
  'name',
  'email',
  'phone',
  'company',
  'subject',
  'choice',
  'message',
];

/** Always shown and always required. */
export const CONTACT_FORM_FIXED_KEYS: readonly ContactFormFieldKey[] = ['email', 'message'];

/** Most options of the select (contracts/blocks.md §4). */
export const CONTACT_FORM_MAX_CHOICES = 30;

const FIELD_TITLES: Record<ContactFormFieldKey, string> = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  company: 'Company',
  subject: 'Subject',
  choice: 'Select',
  message: 'Message',
};

const SHOW = createToggleField({ label: 'Show' });
const REQUIRED = createToggleField({ label: 'Required' });
const LABEL = { type: 'text' as const, label: 'Label' };
const PLACEHOLDER = { type: 'text' as const, label: 'Placeholder' };
const SPAN = {
  type: 'radio' as const,
  label: 'Width',
  options: [
    { label: 'Half', value: 'half' },
    { label: 'Full', value: 'full' },
  ],
};
const CHOICE_OPTIONS = {
  type: 'array' as const,
  label: 'Options',
  max: CONTACT_FORM_MAX_CHOICES,
  arrayFields: { label: { type: 'text' as const, label: 'Label' } },
  defaultItemProps: { label: 'Option' },
  getItemSummary: (item: { label?: string }) => item?.label || 'Option',
};

/** One field's group, for whether it is shown and whether there are two columns. */
function fieldGroup(key: ContactFormFieldKey, shown: boolean, twoColumns: boolean) {
  const fixed = CONTACT_FORM_FIXED_KEYS.includes(key);
  const objectFields: Record<string, unknown> = fixed ? {} : { show: SHOW };
  if (fixed || shown) {
    objectFields['label'] = LABEL;
    objectFields['placeholder'] = PLACEHOLDER;
    if (!fixed) objectFields['required'] = REQUIRED;
    if (key === 'choice') objectFields['options'] = CHOICE_OPTIONS;
    if (twoColumns) objectFields['span'] = SPAN;
  }
  return { type: 'object' as const, label: FIELD_TITLES[key], objectFields };
}

/** Every group, once per shape: `<key>|<shown>|<two columns>`. */
const GROUPS = new Map<string, ReturnType<typeof fieldGroup>>();
function cachedGroup(key: ContactFormFieldKey, shown: boolean, twoColumns: boolean) {
  const id = `${key}|${shown}|${twoColumns}`;
  let group = GROUPS.get(id);
  if (!group) {
    group = fieldGroup(key, shown, twoColumns);
    GROUPS.set(id, group);
  }
  return group;
}

/** The `fields` object, once per shape. */
const FIELD_SETS = new Map<string, { type: 'object'; label: string; objectFields: Record<string, unknown> }>();
function fieldsField(shown: Record<ContactFormFieldKey, boolean>, twoColumns: boolean) {
  const id = `${CONTACT_FORM_FIELD_KEYS.map((key) => (shown[key] ? 1 : 0)).join('')}|${twoColumns}`;
  let field = FIELD_SETS.get(id);
  if (!field) {
    field = {
      type: 'object',
      label: 'Fields',
      objectFields: Object.fromEntries(CONTACT_FORM_FIELD_KEYS.map((key) => [key, cachedGroup(key, shown[key], twoColumns)])),
    };
    FIELD_SETS.set(id, field);
  }
  return field;
}

/** Whether a field is shown, as the renderer decides it. */
export function contactFieldShown(props: Pick<ContactFormProps, 'fields'>, key: ContactFormFieldKey): boolean {
  if (CONTACT_FORM_FIXED_KEYS.includes(key)) return true;
  const show = props.fields?.[key]?.show;
  return typeof show === 'boolean' ? show : key === 'name';
}

const PRIVACY_CONSENT_FIELD = {
  type: 'object' as const,
  label: 'Privacy consent',
  objectFields: { label: createInlineRichTextField({ label: 'Label' }) },
};
const MARKETING_LABEL = createInlineRichTextField({ label: 'Label' });
const MARKETING_SHOW = createToggleField({ label: 'Show' });
const MARKETING_CONSENT_OFF = {
  type: 'object' as const,
  label: 'Marketing consent',
  objectFields: { show: MARKETING_SHOW },
};
const MARKETING_CONSENT_ON = {
  type: 'object' as const,
  label: 'Marketing consent',
  objectFields: { show: MARKETING_SHOW, label: MARKETING_LABEL },
};

const MESSAGES_FIELD = {
  type: 'object' as const,
  label: 'Messages',
  objectFields: {
    success: { type: 'textarea' as const, label: 'Sent' },
    error: { type: 'textarea' as const, label: 'Not accepted' },
    unavailable: { type: 'textarea' as const, label: 'Unavailable' },
  },
};

/** The submit button: the button look of every embedded button, without a link. */
const BUTTON_FIELD = {
  type: 'object' as const,
  label: 'Button',
  objectFields: Object.fromEntries(Object.entries(BUTTON_SPEC_OBJECT_FIELDS).filter(([key]) => key !== 'link')),
};

/** The static set, in the order the editor shows it (`withHideOn` adds "Hide on"). */
export const CONTACT_FORM_FIELDS = {
  // Content
  fields: fieldsField({ name: true, email: true, phone: false, company: false, subject: false, choice: false, message: true }, false),
  privacyConsent: PRIVACY_CONSENT_FIELD,
  marketingConsent: MARKETING_CONSENT_OFF,
  messages: MESSAGES_FIELD,
  formLabel: { type: 'text' as const, label: 'Form name (screen readers)' },
  // Layout
  columns: {
    type: 'radio' as const,
    label: 'Columns',
    options: [
      { label: 'One', value: 1 },
      { label: 'Two', value: 2 },
    ],
  },
  labelPosition: {
    type: 'radio' as const,
    label: 'Labels',
    options: [
      { label: 'Above the field', value: 'above' },
      { label: 'Hidden (screen readers only)', value: 'hidden' },
    ],
  },
  buttonAlign: {
    type: 'select' as const,
    label: 'Button alignment',
    options: [
      { label: 'Start', value: 'start' },
      { label: 'Center', value: 'center' },
      { label: 'End', value: 'end' },
      { label: 'Full width', value: 'stretch' },
    ],
  },
  // Style
  fieldLook: {
    type: 'select' as const,
    label: 'Field look',
    options: [
      { label: 'Boxed', value: 'boxed' },
      { label: 'Underline', value: 'underline' },
      { label: 'Pill', value: 'pill' },
    ],
  },
  button: BUTTON_FIELD,
  // Spacing
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

/**
 * The fields for these props: a hidden field's settings, the spans with one column and the
 * marketing label while it is off are not shown. Every key keeps its place; only the cached
 * `fields` and `marketingConsent` objects change.
 */
export function resolveContactFormFields(props: ContactFormProps, base: Record<string, unknown>): Fields {
  const shown = Object.fromEntries(CONTACT_FORM_FIELD_KEYS.map((key) => [key, contactFieldShown(props, key)])) as Record<
    ContactFormFieldKey,
    boolean
  >;
  const twoColumns = Number(props.columns) === 2;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(base)) {
    if (key === 'fields') out[key] = fieldsField(shown, twoColumns);
    else if (key === 'marketingConsent') out[key] = props.marketingConsent?.show === true ? MARKETING_CONSENT_ON : MARKETING_CONSENT_OFF;
    else out[key] = field;
  }
  return out as Fields;
}
