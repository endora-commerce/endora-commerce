'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import { withHideOn, type ButtonSpec, type InlineRichText } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type {
  ContactFormChoiceConfig,
  ContactFormFieldConfig,
  ContactFormFieldKey,
  ContactFormMessages,
  ContactFormProps,
} from '../schema/component-types.js';
import { DEFAULT_BOX_PROPS } from '../fields/shared-fields.js';
import { BoxStyled } from './box-styles.js';
import { ButtonView } from './ButtonView.js';
import { InlineRich } from './InlineRich.js';
import { useSectionAnchor } from './Section.js';
import { useBlockDomId } from './block-dom-id.js';
import {
  useCmsRenderContactFormText,
  useCmsRenderLocalizePath,
  useCmsRenderLocation,
  type CmsContactFormText,
  type CmsRenderLocation,
} from './render-context.js';
import {
  CONTACT_FORM_FIELD_KEYS,
  CONTACT_FORM_FIELDS,
  CONTACT_FORM_FIXED_KEYS,
  CONTACT_FORM_MAX_CHOICES,
  contactFieldShown,
  resolveContactFormFields,
} from './ContactFormFields.js';

/**
 * `cms.ContactForm` — `specs/169-page-builder-contact-form/` US6, FR-015, FR-016,
 * contracts/blocks.md §4, data-model §3.
 *
 * A plain `<form method="post" action="/forms/contact">` over a fixed field set the server
 * knows. The storefront's handler checks it, asks the `cms` module to e-mail the sales
 * channel's recipients (a setting, never a prop of this block) and answers `303` back to this
 * page with the outcome on the URL (`?contact=…&form=<this block's id>#anchor`), so a visitor
 * without JavaScript sees it in the server HTML. With JavaScript the form checks itself, marks
 * each invalid field, posts with `fetch` and shows the outcome inline; what the shopper typed is
 * kept until the message is sent.
 *
 * The look follows the colour scheme of the section it sits in: three field looks, one or two
 * columns, the label above or visually hidden, and the submit button through the button look of
 * every other button (feature 163's presets — no px and no free colour here).
 */

/** The storefront handler the form posts to (contracts/contact-form-api.md §3). */
export const CONTACT_FORM_PATH = '/forms/contact';

/** A deliberately loose check: the handler applies the contract's own rule. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The query keys the handler puts on this page. */
const OUTCOME_KEYS = ['contact', 'reason', 'form'] as const;

type Outcome = 'sent' | 'error' | 'unavailable' | null;
type InvalidReason = 'required' | 'email';
type FieldName = ContactFormFieldKey | 'privacyConsent';

const ENGLISH: Required<Omit<CmsContactFormText, 'field'>> & { field: Record<ContactFormFieldKey, string> } = {
  label: 'Contact form',
  field: {
    name: 'Name',
    email: 'E-mail',
    phone: 'Phone',
    company: 'Company',
    subject: 'Subject',
    choice: 'Choose',
    message: 'Message',
  },
  choicePlaceholder: 'Choose…',
  privacyConsent: 'I agree to the processing of my data to answer this message.',
  marketingConsent: 'I would like to receive news and offers by e-mail.',
  submit: 'Send',
  success: 'Thank you. Your message has been sent.',
  error: 'Please check the highlighted fields and try again.',
  unavailable: 'The message could not be sent right now. Please try again later.',
  required: '(required)',
  fieldRequired: 'This field is required.',
  fieldEmail: 'Enter a valid e-mail address.',
};

const AUTOCOMPLETE: Partial<Record<ContactFormFieldKey, string>> = {
  name: 'name',
  email: 'email',
  phone: 'tel',
  company: 'organization',
};

const INPUT_TYPE: Partial<Record<ContactFormFieldKey, string>> = { email: 'email', phone: 'tel' };

/** A non-empty trimmed string, or `undefined`. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

/** The page to come back to, without an earlier outcome on it. */
function returnPathOf(path: string, query: Readonly<Record<string, string>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (!(OUTCOME_KEYS as readonly string[]).includes(key)) params.append(key, value);
  }
  const search = params.toString();
  return `${path}${search ? `?${search}` : ''}`;
}

/** The outcome the handler put on the URL, when it is about this block. */
function outcomeFromQuery(query: CmsRenderLocation['query'] | undefined, formId: string): Outcome {
  if (!query || query['form'] !== formId) return null;
  if (query['contact'] === 'sent') return 'sent';
  if (query['contact'] !== 'error') return null;
  return query['reason'] === 'unavailable' ? 'unavailable' : 'error';
}

/** The select's valid options, at most 30. */
function choiceOptions(config: ContactFormChoiceConfig | undefined): string[] {
  return (config?.options ?? [])
    .map((option) => text(option?.label))
    .filter((label): label is string => label !== undefined && label.length <= 200)
    .slice(0, CONTACT_FORM_MAX_CHOICES);
}

interface ResolvedField {
  key: ContactFormFieldKey;
  label: string;
  placeholder: string | undefined;
  required: boolean;
  full: boolean;
  options: string[];
}

/** The fields this block renders, in order, with their words resolved. */
function resolvedFields(props: ContactFormProps, words: typeof ENGLISH, labelsHidden: boolean): ResolvedField[] {
  const out: ResolvedField[] = [];
  for (const key of CONTACT_FORM_FIELD_KEYS) {
    if (!contactFieldShown(props, key)) continue;
    const config: ContactFormFieldConfig | undefined = props.fields?.[key];
    const options = key === 'choice' ? choiceOptions(config as ContactFormChoiceConfig | undefined) : [];
    if (key === 'choice' && options.length === 0) continue;
    const label = text(config?.label) ?? words.field[key];
    const fixed = CONTACT_FORM_FIXED_KEYS.includes(key);
    const span = config?.span === 'full' || config?.span === 'half' ? config.span : key === 'message' ? 'full' : 'half';
    out.push({
      key,
      label,
      placeholder: text(config?.placeholder) ?? (labelsHidden && key !== 'choice' ? label : undefined),
      required: fixed || config?.required === true,
      full: span === 'full',
      options,
    });
  }
  return out;
}

function messageOf(messages: ContactFormMessages | undefined, key: keyof ContactFormMessages, words: typeof ENGLISH): string {
  return text(messages?.[key]) ?? words[key];
}

function ContactFormBody({
  props,
  editing,
  tier,
}: {
  props: ContactFormProps;
  editing: boolean;
  tier: 'mobile' | 'tablet' | 'desktop' | null;
}): ReactNode {
  const pageWords = useCmsRenderContactFormText();
  const words: typeof ENGLISH = {
    ...ENGLISH,
    ...Object.fromEntries(Object.entries(pageWords ?? {}).filter(([key, value]) => key !== 'field' && text(value) !== undefined)),
    field: { ...ENGLISH.field, ...Object.fromEntries(Object.entries(pageWords?.field ?? {}).filter(([, value]) => text(value) !== undefined)) },
  };
  const location = useCmsRenderLocation();
  // Feature 167 — the form posts to, and comes back to, the page's own language.
  const localizePath = useCmsRenderLocalizePath();
  const action = localizePath(CONTACT_FORM_PATH);
  const blockId = typeof (props as { id?: unknown }).id === 'string' ? ((props as { id: string }).id) : '';
  const baseId = useBlockDomId('pb-contact', blockId);
  const anchor = useSectionAnchor();
  const [returnTo, setReturnTo] = useState(() =>
    localizePath(location ? returnPathOf(location.path, location.query) : '/'),
  );
  const [outcome, setOutcome] = useState<Outcome>(() => outcomeFromQuery(location?.query, blockId));
  const [invalid, setInvalid] = useState<Partial<Record<FieldName, InvalidReason>>>({});
  const [enhanced, setEnhanced] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnhanced(true);
    if (!location && typeof window !== 'undefined') {
      setReturnTo(returnPathOf(window.location.pathname, Object.fromEntries(new URLSearchParams(window.location.search))));
    }
  }, [location]);

  const labelsHidden = props.labelPosition === 'hidden';
  const fields = resolvedFields(props, words, labelsHidden);
  const columns = Number(props.columns) === 2 ? 2 : 1;
  const look = oneOf(props.fieldLook, ['boxed', 'underline', 'pill'] as const, 'boxed');
  const buttonAlign = oneOf(props.buttonAlign, ['start', 'center', 'end', 'stretch'] as const, 'start');
  const choice = fields.find((field) => field.key === 'choice');
  const required = fields.filter((field) => field.required && !CONTACT_FORM_FIXED_KEYS.includes(field.key));
  const marketing = props.marketingConsent?.show === true;
  const idOf = (name: FieldName) => `${baseId}-${name}`;
  const errorIdOf = (name: FieldName) => `${baseId}-${name}-error`;

  const button: ButtonSpec = {
    style: 'primary',
    fill: 'solid',
    size: 'medium',
    ...(props.button ?? {}),
    label: text(props.button?.label) ?? words.submit,
  } as ButtonSpec;

  /** Every invalid field, in render order, checked as the handler will. */
  function check(form: HTMLFormElement): Array<[FieldName, InvalidReason]> {
    const data = new FormData(form);
    const found: Array<[FieldName, InvalidReason]> = [];
    for (const field of fields) {
      const value = String(data.get(field.key) ?? '').trim();
      if (field.required && value === '') found.push([field.key, 'required']);
      else if (field.key === 'email' && !EMAIL_RE.test(value)) found.push(['email', 'email']);
    }
    if (data.get('privacyConsent') !== 'on') found.push(['privacyConsent', 'required']);
    return found;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (editing || busy) return;
    const form = event.currentTarget;
    const found = check(form);
    setInvalid(Object.fromEntries(found));
    if (found.length > 0) {
      setOutcome(null);
      const [first] = found[0]!;
      document.getElementById(idOf(first))?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(action, { method: 'POST', headers: { Accept: 'application/json' }, body: new FormData(form) });
      const answer = (await res.json().catch(() => null)) as { status?: string; error?: string } | null;
      if (answer?.status === 'sent') {
        setOutcome('sent');
        form.reset();
      } else {
        setOutcome(answer?.error === 'invalid' ? 'error' : 'unavailable');
      }
    } catch {
      setOutcome('unavailable');
    } finally {
      setBusy(false);
    }
  }

  const invalidProps = (name: FieldName) =>
    invalid[name] ? { 'aria-invalid': true as const, 'aria-describedby': errorIdOf(name) } : {};
  const errorFor = (name: FieldName) =>
    invalid[name] ? (
      <p id={errorIdOf(name)} className="cmsc-pb-contact-form__error">
        {invalid[name] === 'email' ? words.fieldEmail : words.fieldRequired}
      </p>
    ) : null;
  const marker = (
    <span className="cmsc-pb-contact-form__req">
      <span aria-hidden="true">*</span>
      <span className="cmsc-sr-only">{words.required}</span>
    </span>
  );

  const rootClass = [
    'cmsc-pb-contact-form',
    `cmsc-pb-contact-form--look-${look}`,
    columns === 2 ? 'cmsc-pb-contact-form--cols-2' : '',
    labelsHidden ? 'cmsc-pb-contact-form--labels-hidden' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const outcomeText =
    outcome === 'sent'
      ? messageOf(props.messages, 'success', words)
      : outcome === 'error'
        ? messageOf(props.messages, 'error', words)
        : outcome === 'unavailable'
          ? messageOf(props.messages, 'unavailable', words)
          : '';
  const { margin, padding, border } = props;

  return (
    <BoxStyled
      {...(margin !== undefined ? { margin } : {})}
      {...(padding !== undefined ? { padding } : {})}
      {...(border !== undefined ? { border } : {})}
      {...(editing && tier ? { previewTier: tier } : {})}
      className="cmsc-pb-contact"
    >
      <form
        className={rootClass}
        method="post"
        action={action}
        aria-label={text(props.formLabel) ?? words.label}
        noValidate={enhanced}
        onSubmit={(event) => void onSubmit(event)}
      >
        <input type="hidden" name="returnTo" value={returnTo} />
        {anchor ? <input type="hidden" name="anchor" value={anchor} /> : null}
        {blockId ? <input type="hidden" name="form" value={blockId} /> : null}
        {choice ? <input type="hidden" name="choiceLabel" value={choice.label} /> : null}
        {required.map((field) => (
          <input key={field.key} type="hidden" name="required" value={field.key} />
        ))}
        <div className="cmsc-pb-contact-form__hp" aria-hidden="true">
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>
        <div className="cmsc-pb-contact-form__fields">
          {fields.map((field) => {
            const fieldClass = [
              'cmsc-pb-contact-form__field',
              columns === 2 && field.full ? 'cmsc-pb-contact-form__field--full' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const common = {
              id: idOf(field.key),
              name: field.key,
              className: 'cmsc-pb-contact-form__control',
              ...(field.required ? { required: true, 'aria-required': true as const } : {}),
              ...invalidProps(field.key),
            };
            return (
              <div key={field.key} className={fieldClass}>
                <label
                  htmlFor={idOf(field.key)}
                  className={labelsHidden ? 'cmsc-pb-contact-form__label cmsc-sr-only' : 'cmsc-pb-contact-form__label'}
                >
                  {field.label}
                  {field.required ? marker : null}
                </label>
                {field.key === 'message' ? (
                  <textarea {...common} rows={6} {...(field.placeholder ? { placeholder: field.placeholder } : {})} />
                ) : field.key === 'choice' ? (
                  <select {...common} defaultValue="">
                    <option value="">{text(props.fields?.choice?.placeholder) ?? words.choicePlaceholder}</option>
                    {field.options.map((option, index) => (
                      <option key={`${option}-${index}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...common}
                    type={INPUT_TYPE[field.key] ?? 'text'}
                    {...(AUTOCOMPLETE[field.key] ? { autoComplete: AUTOCOMPLETE[field.key] } : {})}
                    {...(field.placeholder ? { placeholder: field.placeholder } : {})}
                  />
                )}
                {errorFor(field.key)}
              </div>
            );
          })}
        </div>
        <div className="cmsc-pb-contact-form__consents">
          <div className="cmsc-pb-contact-form__check">
            <input
              id={idOf('privacyConsent')}
              type="checkbox"
              name="privacyConsent"
              value="on"
              required
              aria-required
              {...invalidProps('privacyConsent')}
            />
            <label htmlFor={idOf('privacyConsent')}>
              <ConsentLabel value={props.privacyConsent?.label} fallback={words.privacyConsent} />
              {marker}
            </label>
            {errorFor('privacyConsent')}
          </div>
          {marketing ? (
            <div className="cmsc-pb-contact-form__check">
              <input id={`${baseId}-marketingConsent`} type="checkbox" name="marketingConsent" value="on" />
              <label htmlFor={`${baseId}-marketingConsent`}>
                <ConsentLabel value={props.marketingConsent?.label} fallback={words.marketingConsent} />
              </label>
            </div>
          ) : null}
        </div>
        <div className={`cmsc-pb-contact-form__actions cmsc-pb-contact-form__actions--${buttonAlign}`}>
          <ButtonView button={button} type="submit" disabled={busy} />
        </div>
        <p
          className={[
            'cmsc-pb-contact-form__outcome',
            outcome === 'sent' ? 'cmsc-pb-contact-form__outcome--success' : '',
            outcome === 'error' || outcome === 'unavailable' ? 'cmsc-pb-contact-form__outcome--error' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="status"
          aria-live="polite"
        >
          {outcomeText}
        </p>
      </form>
      {editing ? (
        <div className="cmsc-pb-contact-form__notes">
          <p className="cmsc-pb-contact-form__note">
            Messages go to the recipients set per sales channel in Settings → Contact form.
          </p>
          {text(consentText(props.privacyConsent?.label)) === undefined ? (
            <p className="cmsc-pb-contact-form__note cmsc-pb-contact-form__note--warning">
              Write the privacy consent label and link it to your privacy policy.
            </p>
          ) : null}
        </div>
      ) : null}
    </BoxStyled>
  );
}

/** The plain text of a consent label, to tell an unset one from a written one. */
function consentText(value: InlineRichText | string | undefined): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const walk = (node: unknown): string => {
    if (!node || typeof node !== 'object') return '';
    const { text: own, content } = node as { text?: unknown; content?: unknown };
    return `${typeof own === 'string' ? own : ''}${Array.isArray(content) ? content.map(walk).join('') : ''}`;
  };
  return walk(value);
}

function ConsentLabel({ value, fallback }: { value: InlineRichText | string | undefined; fallback: string }): ReactNode {
  if (text(consentText(value)) === undefined) return fallback;
  return <InlineRich value={value} />;
}

const ContactFormEditingRender: PuckComponent<ContactFormProps> = (props) => (
  <ContactFormBody props={props as unknown as ContactFormProps} editing tier={usePreviewBreakpointTier()} />
);

const ContactFormPublishedRender: PuckComponent<ContactFormProps> = (props) => (
  <ContactFormBody props={props as unknown as ContactFormProps} editing={false} tier={null} />
);

const contactFormConfig: ComponentConfig<{ props: ContactFormProps }> = {
  label: 'Contact form',
  fields: CONTACT_FORM_FIELDS as unknown as Fields<ContactFormProps>,
  defaultProps: {
    fields: {
      name: { show: true, required: false },
      phone: { show: false },
      company: { show: false },
      subject: { show: false },
      choice: { show: false, options: [] },
    },
    marketingConsent: { show: false },
    columns: 1,
    fieldLook: 'boxed',
    labelPosition: 'above',
    buttonAlign: 'start',
    button: { label: '', style: 'primary', fill: 'solid', size: 'medium' },
    ...DEFAULT_BOX_PROPS,
  } as ContactFormProps,
  resolveFields: (data, params) =>
    resolveContactFormFields(
      data.props as ContactFormProps,
      ((params?.fields as Record<string, unknown> | undefined) ?? CONTACT_FORM_FIELDS) as Record<string, unknown>,
    ) as unknown as Fields<ContactFormProps>,
  render: (props) =>
    props.puck?.isEditing ? <ContactFormEditingRender {...props} /> : <ContactFormPublishedRender {...props} />,
};

/**
 * The block, exported under its name's local segment (`cms.ContactForm`), as every block of
 * this package is: the SSR floor reconciles the components map with the exported block configs
 * by that segment.
 */
export const ContactForm = withHideOn(contactFormConfig);
