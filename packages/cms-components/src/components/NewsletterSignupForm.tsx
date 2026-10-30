'use client';

import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { FieldLabel, type ComponentConfig, type Fields, type PuckComponent } from '@puckeditor/core';
import {
  PB_FIELD_INPUT_CLASS,
  plainTextToInlineRichText,
  withHideOn,
  type InlineRichText,
  createToggleField,
} from '@endora-commerce/page-builder-core';
import { usePageBuilderPuck } from '@endora-commerce/page-builder-core/editor/use-page-builder-puck';
import type {
  NewsletterSignupAttribute,
  NewsletterSignupFormProps,
  NewsletterSignupMessages,
  NewsletterSignupTopic,
} from '../schema/component-types.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { createRichTextDocField } from '../fields/rich-text-doc-field.js';
import { levelField } from '../fields/section-block-fields.js';
import { useSectionAnchor } from './Section.js';
import { InlineRich } from './InlineRich.js';
import { useBlockDomId } from './block-dom-id.js';
import {
  useCmsRenderLocalizePath,
  useCmsRenderLocation,
  useCmsRenderNewsletterSignupText,
  type CmsRenderLocation,
} from './render-context.js';
import { BlockHeading, plainTextToDoc, RichBody } from './section-parts.js';
import { createIconPickerField } from './IconPickerField.js';
import { resolveCmsIcon } from './icon-catalog.js';

/**
 * `newsletter.Signup` — `specs/163-page-builder-marketing-pages/` US7, FR-029,
 * research R-17, contracts/blocks.md. Declared by the `newsletter` module,
 * rendered from here, and gone from every page while that module is off.
 *
 * A plain `<form method="post" action="/newsletter/subscribe">`: the
 * storefront's handler subscribes through the newsletter module, with the
 * chosen topics as tags and the consent recorded, and answers `303` back to
 * this page with the outcome on the URL (`?newsletter=…&reason=…#anchor`, the
 * anchor of the enclosing `cms.Section` when it has one). The
 * outcome is read from the rendered page's location, so it is in the server
 * HTML and a visitor without JavaScript sees it. With JavaScript the form
 * checks the e-mail and the consent itself, posts with `fetch` and shows the
 * outcome inline; the typed address is never lost.
 */

/** The storefront handler the form posts to (contracts/storefront-and-admin-api.md §4). */
export const NEWSLETTER_SUBSCRIBE_PATH = '/newsletter/subscribe';

/** Most topics one sign-up offers (contracts/blocks.md). */
export const NEWSLETTER_SIGNUP_MAX_TOPICS = 12;

/** A topic is a newsletter tag code; the handler drops anything else. */
const TOPIC_CODE_RE = /^[a-z0-9_-]{1,64}$/;

/** A deliberately loose check: the handler applies the backend's own rule. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Feature 169 (FR-025): most subscriber attributes one sign-up offers (contracts/blocks.md §5). */
export const NEWSLETTER_SIGNUP_MAX_ATTRIBUTES = 10;

/** A newsletter custom field key; an attribute naming anything else is skipped. */
const ATTRIBUTE_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** The custom field types an attribute renders, in the editor's order. */
const ATTRIBUTE_TYPES = ['text', 'number', 'boolean', 'date'] as const;
type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

/** The longest text value the newsletter keeps (feature 169, research R-11). */
const ATTRIBUTE_TEXT_MAX = 500;

type SignupError = 'consent' | 'email' | 'topics' | 'fields' | 'unavailable';
type Outcome = { status: 'pending' | 'active' } | { error: SignupError } | null;

const ERRORS: readonly SignupError[] = ['consent', 'email', 'topics', 'fields', 'unavailable'];

/** The outcome the handler put on the URL, if any. */
function outcomeFromQuery(query: CmsRenderLocation['query'] | undefined): Outcome {
  const status = query?.['newsletter'];
  if (status === 'pending' || status === 'active') return { status };
  if (status !== 'error') return null;
  const reason = query?.['reason'] as SignupError | undefined;
  return { error: reason && ERRORS.includes(reason) ? reason : 'unavailable' };
}

/** The page to come back to, without an earlier outcome on it. */
function returnPathOf(path: string, query: Readonly<Record<string, string>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key !== 'newsletter' && key !== 'reason') params.append(key, value);
  }
  const search = params.toString();
  return `${path}${search ? `?${search}` : ''}`;
}

function validTopics(topics: NewsletterSignupTopic[] | undefined): Array<{ label: string; tagCode: string }> {
  return (topics ?? [])
    .filter((topic): topic is { label: string; tagCode: string } =>
      !!topic && typeof topic.tagCode === 'string' && TOPIC_CODE_RE.test(topic.tagCode) && typeof topic.label === 'string' && topic.label.trim() !== '',
    )
    .slice(0, NEWSLETTER_SIGNUP_MAX_TOPICS);
}

interface ValidAttribute {
  key: string;
  type: AttributeType;
  label: string;
  placeholder: string | undefined;
  required: boolean;
}

/** Feature 169: the attributes the form shows — a valid key and type each, at most 10. */
function validAttributes(attributes: NewsletterSignupAttribute[] | undefined): ValidAttribute[] {
  if (!Array.isArray(attributes)) return [];
  const seen = new Set<string>();
  const valid: ValidAttribute[] = [];
  for (const attribute of attributes) {
    if (valid.length === NEWSLETTER_SIGNUP_MAX_ATTRIBUTES) break;
    const key = attribute?.key;
    const type = attribute?.type;
    if (typeof key !== 'string' || !ATTRIBUTE_KEY_RE.test(key) || seen.has(key)) continue;
    if (!(ATTRIBUTE_TYPES as readonly unknown[]).includes(type)) continue;
    seen.add(key);
    const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
    valid.push({
      key,
      type: type as AttributeType,
      label: text(attribute.label) ?? text(attribute.fieldLabel) ?? key,
      placeholder: type === 'boolean' ? undefined : text(attribute.placeholder),
      required: attribute.required === true,
    });
  }
  return valid;
}

/** Feature 169: the `fields` message when neither the block nor the page language has one. */
const DEFAULT_FIELDS_MESSAGE = 'Please fill in the required fields.';

const DEFAULT_MESSAGES: Required<Omit<NewsletterSignupMessages, 'fields'>> = {
  pending: 'Almost done: check your inbox and confirm your subscription.',
  active: 'Thank you, you are subscribed.',
  consent: 'Please accept the consent to subscribe.',
  email: 'Enter a valid e-mail address.',
  topics: 'Choose at least one topic.',
  unavailable: 'The sign-up is not available right now. Please try again later.',
};

function message(messages: NewsletterSignupMessages | undefined, key: Exclude<keyof NewsletterSignupMessages, 'fields'>): string {
  const value = messages?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : DEFAULT_MESSAGES[key];
}

/** The consent label a block shows when the editor wrote none. */
const DEFAULT_CONSENT_LABEL: InlineRichText = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'I agree to receive the newsletter and accept the ' },
        { type: 'text', text: 'privacy policy', marks: [{ type: 'link', attrs: { href: '/privacy-policy' } }] },
        { type: 'text', text: '.' },
      ],
    },
  ],
} as InlineRichText;

/** R19B (T252): the topics' columns, 1–4, or `null` for today's wrapping row. */
function topicColumns(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(4, Math.max(1, Math.round(n)));
}

function SignupBody({ props, editing }: { props: NewsletterSignupFormProps; editing: boolean }): ReactNode {
  const location = useCmsRenderLocation();
  // Feature 167 — the form posts to, and comes back to, the page's own language.
  const localizePath = useCmsRenderLocalizePath();
  const subscribePath = localizePath(NEWSLETTER_SUBSCRIBE_PATH);
  const [returnTo, setReturnTo] = useState(() =>
    localizePath(location ? returnPathOf(location.path, location.query) : '/'),
  );
  const [outcome, setOutcome] = useState<Outcome>(() => outcomeFromQuery(location?.query));
  const [enhanced, setEnhanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  // Feature 169: the required attributes the last submit found empty.
  const [missing, setMissing] = useState<readonly string[]>([]);
  const signupText = useCmsRenderNewsletterSignupText();
  // The block's id, not `useId()` alone: the same on the server and on hydration (T149).
  const baseId = useBlockDomId('pb-signup', (props as { id?: unknown }).id);
  const ids = {
    email: `${baseId}-email`,
    emailError: `${baseId}-email-error`,
    consent: `${baseId}-consent`,
    consentError: `${baseId}-consent-error`,
    topicsError: `${baseId}-topics-error`,
    fieldsError: `${baseId}-fields-error`,
  };

  useEffect(() => {
    // From here on the form checks itself and shows its own messages.
    setEnhanced(true);
    if (!location && typeof window !== 'undefined') {
      setReturnTo(returnPathOf(window.location.pathname, Object.fromEntries(new URLSearchParams(window.location.search))));
    }
  }, [location]);

  const topics = validTopics(props.topics);
  const attributes = validAttributes(props.attributes);
  // Back to the enclosing `cms.Section`, when it has an anchor.
  const anchor = useSectionAnchor();
  const error = outcome && 'error' in outcome ? outcome.error : null;
  const done = outcome && 'status' in outcome ? outcome.status : null;
  const layout = props.layout === 'inline' ? 'inline' : 'boxed';
  // R19B (T252): the button inside the field (rounded or a pill), topics in columns, a visually hidden label.
  const inside = props.buttonPlacement === 'inside';
  const pill = inside && props.fieldShape === 'pill';
  const columns = topicColumns(props.topicsColumns);
  // R22I (T380): an icon after the button's label. R23 (T443): the button's own height, text size and weight
  // (R21G) and the topic labels' size (R22I) were removed — the button and the labels keep today's look.
  const ButtonIcon = resolveCmsIcon(props.buttonIcon);
  const topicsStyle = { ...(columns ? { '--pb-topic-cols': String(columns) } : {}) };
  const rootClass = [
    'cmsc-pb-signup',
    `cmsc-pb-signup--${layout}`,
    inside ? 'cmsc-pb-signup--button-inside' : '',
    pill ? 'cmsc-pb-signup--pill' : '',
  ]
    .filter(Boolean)
    .join(' ');

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (editing || busy) return;
    const form = event.currentTarget;
    const email = emailRef.current?.value.trim() ?? '';
    if (!EMAIL_RE.test(email)) {
      setOutcome({ error: 'email' });
      emailRef.current?.focus();
      return;
    }
    if (!consentRef.current?.checked) {
      setOutcome({ error: 'consent' });
      consentRef.current?.focus();
      return;
    }
    const body = new FormData(form);
    if (props.topicsRequired === true && topics.length > 0 && body.getAll('topics').length === 0) {
      setOutcome({ error: 'topics' });
      return;
    }
    // Feature 169: a required attribute — a box ticked, any other filled in.
    const empty = attributes
      .filter((attribute) => attribute.required)
      .filter((attribute) => {
        const value = body.get(`attr.${attribute.key}`);
        return attribute.type === 'boolean' ? value !== 'on' : typeof value !== 'string' || value.trim() === '';
      })
      .map((attribute) => attribute.key);
    setMissing(empty);
    if (empty.length > 0) {
      setOutcome({ error: 'fields' });
      form.querySelector<HTMLInputElement>(`[name="attr.${empty[0]}"]`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(subscribePath, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body,
      });
      const answer = (await res.json().catch(() => null)) as { status?: string; error?: string } | null;
      if (answer?.status === 'pending' || answer?.status === 'active') setOutcome({ status: answer.status });
      else setOutcome({ error: ERRORS.includes(answer?.error as SignupError) ? (answer!.error as SignupError) : 'unavailable' });
    } catch {
      setOutcome({ error: 'unavailable' });
    } finally {
      setBusy(false);
    }
  }

  const errorText = (key: Exclude<SignupError, 'fields'>) => message(props.messages, key);
  const fieldsText = (): string => {
    const own = props.messages?.fields;
    if (typeof own === 'string' && own.trim() !== '') return own;
    const translated = signupText?.fields;
    return typeof translated === 'string' && translated.trim() !== '' ? translated : DEFAULT_FIELDS_MESSAGE;
  };
  const attributeInvalid = (key: string): boolean => error === 'fields' && missing.includes(key);

  const emailInput = (
    <input
      ref={emailRef}
      id={ids.email}
      className="cmsc-pb-signup__input"
      type="email"
      name="email"
      autoComplete="email"
      required
      placeholder={props.placeholder ?? ''}
      {...(error === 'email' ? { 'aria-invalid': true, 'aria-describedby': ids.emailError } : {})}
    />
  );
  const submitButton = (
    <button
      type="submit"
      className={['cmsc-pb-signup__button', ...(ButtonIcon ? ['cmsc-pb-signup__button--icon'] : [])].join(' ')}
      disabled={busy}
      aria-busy={busy || undefined}
    >
      {props.buttonLabel?.trim() || 'Subscribe'}
      {ButtonIcon ? <ButtonIcon className="cmsc-pb-signup__button-icon" aria-hidden="true" focusable="false" /> : null}
    </button>
  );

  return (
    <div className={rootClass}>
      <BlockHeading
        value={props.heading}
        level={props.headingLevel}
        size={undefined}
        sizePx={undefined}
        className="cmsc-pb-signup__heading"
        tier={null}
      />
      <RichBody value={props.text} className="cmsc-pb-signup__text cmsc-pb-rich" />
      <form
        className="cmsc-pb-signup__form"
        method="post"
        action={subscribePath}
        noValidate={enhanced}
        onSubmit={(event) => void onSubmit(event)}
      >
        <input type="hidden" name="returnTo" value={returnTo} />
        {anchor ? <input type="hidden" name="anchor" value={anchor} /> : null}
        {props.topicsRequired === true && topics.length > 0 ? <input type="hidden" name="topicsRequired" value="on" /> : null}
        <div className="cmsc-pb-signup__row">
          <div className="cmsc-pb-signup__field">
            <label
              className={props.hideEmailLabel === true ? 'cmsc-pb-signup__label cmsc-sr-only' : 'cmsc-pb-signup__label'}
              htmlFor={ids.email}
            >
              {props.emailLabel?.trim() || 'E-mail address'}
            </label>
            {inside ? <div className="cmsc-pb-signup__control">{emailInput}{submitButton}</div> : emailInput}
            {error === 'email' ? (
              <p id={ids.emailError} className="cmsc-pb-signup__error">
                {errorText('email')}
              </p>
            ) : null}
          </div>
          {inside ? null : submitButton}
        </div>
        {attributes.length > 0 ? (
          <div className="cmsc-pb-signup__attributes">
            {attributes.map((attribute, index) => {
              const id = `${baseId}-attr-${index}`;
              const invalid = attributeInvalid(attribute.key);
              const label = (
                <label className={attribute.type === 'boolean' ? undefined : 'cmsc-pb-signup__label'} htmlFor={id}>
                  {attribute.label}
                  {attribute.required ? (
                    <span className="cmsc-pb-signup__required" aria-hidden="true">
                      {' *'}
                    </span>
                  ) : null}
                </label>
              );
              const common = {
                id,
                name: `attr.${attribute.key}`,
                ...(attribute.required ? { required: true } : {}),
                ...(invalid ? { 'aria-invalid': true, 'aria-describedby': ids.fieldsError } : {}),
              };
              return (
                <div
                  key={`${attribute.key}-${index}`}
                  className={attribute.type === 'boolean' ? 'cmsc-pb-signup__check cmsc-pb-signup__attribute' : 'cmsc-pb-signup__field cmsc-pb-signup__attribute'}
                >
                  <input type="hidden" name="attrSpec" value={`${attribute.key}|${attribute.type}|${attribute.required ? 1 : 0}`} />
                  {attribute.type === 'boolean' ? (
                    <>
                      <input {...common} type="checkbox" value="on" />
                      {label}
                    </>
                  ) : (
                    <>
                      {label}
                      <input
                        {...common}
                        className="cmsc-pb-signup__input"
                        type={attribute.type}
                        {...(attribute.type === 'text' ? { maxLength: ATTRIBUTE_TEXT_MAX } : {})}
                        {...(attribute.placeholder ? { placeholder: attribute.placeholder } : {})}
                      />
                    </>
                  )}
                </div>
              );
            })}
            {error === 'fields' ? (
              <p id={ids.fieldsError} className="cmsc-pb-signup__error">
                {fieldsText()}
              </p>
            ) : null}
          </div>
        ) : null}
        {topics.length > 0 ? (
          <fieldset
            className={['cmsc-pb-signup__topics', ...(columns ? ['cmsc-pb-signup__topics--columns'] : [])].join(' ')}
            {...(Object.keys(topicsStyle).length > 0 ? { style: topicsStyle as CSSProperties } : {})}
            {...(error === 'topics' ? { 'aria-describedby': ids.topicsError } : {})}
          >
            <legend className="cmsc-pb-signup__legend">{props.topicsLegend?.trim() || 'Topics'}</legend>
            {topics.map((topic, index) => (
              <div key={`${topic.tagCode}-${index}`} className="cmsc-pb-signup__check">
                <input id={`${baseId}-topic-${index}`} type="checkbox" name="topics" value={topic.tagCode} />
                <label htmlFor={`${baseId}-topic-${index}`}>{topic.label}</label>
              </div>
            ))}
            {error === 'topics' ? (
              <p id={ids.topicsError} className="cmsc-pb-signup__error">
                {errorText('topics')}
              </p>
            ) : null}
          </fieldset>
        ) : null}
        <div className="cmsc-pb-signup__consent cmsc-pb-signup__check">
          <input
            ref={consentRef}
            id={ids.consent}
            type="checkbox"
            name="consent"
            value="on"
            required
            {...(error === 'consent' ? { 'aria-invalid': true, 'aria-describedby': ids.consentError } : {})}
          />
          <label htmlFor={ids.consent}>
            <InlineRich value={props.consentLabel ?? DEFAULT_CONSENT_LABEL} />
          </label>
          {error === 'consent' ? (
            <p id={ids.consentError} className="cmsc-pb-signup__error">
              {errorText('consent')}
            </p>
          ) : null}
        </div>
        <p
          className={['cmsc-pb-signup__message', error === 'unavailable' ? 'cmsc-pb-signup__message--error' : ''].filter(Boolean).join(' ')}
          role="status"
          aria-live="polite"
        >
          {done ? message(props.messages, done) : error === 'unavailable' ? errorText('unavailable') : null}
        </p>
      </form>
    </div>
  );
}

const SignupEditingRender: PuckComponent<NewsletterSignupFormProps> = (props) => (
  <SignupBody props={props as unknown as NewsletterSignupFormProps} editing />
);

const SignupPublishedRender: PuckComponent<NewsletterSignupFormProps> = (props) => (
  <SignupBody props={props as unknown as NewsletterSignupFormProps} editing={false} />
);

/**
 * Feature 169 (contracts/blocks.md §5): whether an attribute's placeholder
 * applies — every type but a box. `name` is the placeholder's field path in the
 * block's props (`attributes[2].placeholder`), as Puck hands it to the field.
 */
export function attributePlaceholderApplies(props: unknown, name: string): boolean {
  const match = /^([A-Za-z_][\w]*)\[(\d+)\]\.placeholder$/.exec(name);
  if (!match) return true;
  const list = (props as Record<string, unknown> | null | undefined)?.[match[1]!];
  const item = Array.isArray(list) ? (list[Number(match[2])] as NewsletterSignupAttribute | undefined) : undefined;
  return item?.type !== 'boolean';
}

function AttributePlaceholderControl({
  name,
  value,
  onChange,
  readOnly,
  label,
  id,
}: {
  name: string;
  value: string | undefined;
  onChange: (value: string) => void;
  readOnly: boolean | undefined;
  label: string;
  id: string | undefined;
}): ReactNode {
  // The item's type is a sibling prop, which a field of an array item is not handed: read from the selected block.
  const applies = usePageBuilderPuck((state) => attributePlaceholderApplies(state.selectedItem?.props, name));
  if (!applies) return null;
  return (
    <FieldLabel label={label} {...(readOnly === true ? { readOnly: true } : {})}>
      <input
        {...(id !== undefined ? { id } : {})}
        type="text"
        className={PB_FIELD_INPUT_CLASS}
        readOnly={readOnly === true}
        value={value ?? ''}
        onChange={(event): void => onChange(event.target.value)}
      />
    </FieldLabel>
  );
}

/** Feature 169: an attribute's placeholder, shown for every type but a box. */
const ATTRIBUTE_PLACEHOLDER_FIELD = {
  type: 'custom' as const,
  label: 'Placeholder',
  render: ({
    name,
    value,
    onChange,
    readOnly,
    field,
    id,
  }: {
    name: string;
    value: string | undefined;
    onChange: (value: string) => void;
    readOnly?: boolean;
    field: { label?: string };
    id?: string;
  }) => (
    <AttributePlaceholderControl
      name={name}
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      label={field.label ?? 'Placeholder'}
      id={id}
    />
  ),
};

const SIGNUP_FIELDS = {
  heading: createInlineRichTextField({ label: 'Heading' }),
  headingLevel: levelField('Heading level'),
  text: createRichTextDocField({ label: 'Text' }),
  emailLabel: { type: 'text' as const, label: 'Email field label' },
  placeholder: { type: 'text' as const, label: 'Email placeholder' },
  buttonLabel: { type: 'text' as const, label: 'Button label' },
  topicsLegend: { type: 'text' as const, label: 'Topics heading' },
  topics: {
    type: 'array' as const,
    label: 'Topics',
    max: NEWSLETTER_SIGNUP_MAX_TOPICS,
    arrayFields: {
      label: { type: 'text' as const, label: 'Label' },
      tagCode: { type: 'text' as const, label: 'Newsletter tag code' },
    },
    defaultItemProps: { label: 'Topic', tagCode: '' },
    getItemSummary: (item: NewsletterSignupTopic) => item?.label || 'Topic',
  },
  topicsRequired: createToggleField({ label: 'A topic must be chosen', defaultValue: false }),
  // Feature 169 (FR-025): subscriber attributes, the newsletter's custom fields. The admin picks the key and
  // type from the existing fields; here they are typed.
  attributes: {
    type: 'array' as const,
    label: 'Subscriber attributes',
    max: NEWSLETTER_SIGNUP_MAX_ATTRIBUTES,
    arrayFields: {
      key: { type: 'text' as const, label: 'Custom field' },
      type: {
        type: 'select' as const,
        label: 'Type',
        options: [
          { label: 'Text', value: 'text' },
          { label: 'Number', value: 'number' },
          { label: 'Yes / no', value: 'boolean' },
          { label: 'Date', value: 'date' },
        ],
      },
      label: { type: 'text' as const, label: 'Label' },
      placeholder: ATTRIBUTE_PLACEHOLDER_FIELD,
      required: createToggleField({ label: 'Required' }),
    },
    defaultItemProps: { key: '', type: 'text' },
    getItemSummary: (item: NewsletterSignupAttribute) =>
      item?.label?.trim() || item?.fieldLabel?.trim() || item?.key?.trim() || 'Attribute',
  },
  consentLabel: createInlineRichTextField({ label: 'Consent label' }),
  layout: {
    type: 'radio' as const,
    label: 'Layout',
    options: [
      { label: 'Boxed', value: 'boxed' },
      { label: 'Inline', value: 'inline' },
    ],
  },
  // R19B (T252): where the button sits, the field's shape with the button inside, the topics' columns, the label.
  buttonPlacement: {
    type: 'radio' as const,
    label: 'Button placement',
    options: [
      { label: 'Beside the field', value: 'beside' },
      { label: 'Inside the field', value: 'inside' },
    ],
  },
  fieldShape: {
    type: 'radio' as const,
    label: 'Field shape',
    options: [
      { label: 'Rounded', value: 'rounded' },
      { label: 'Pill', value: 'pill' },
    ],
  },
  topicsColumns: { type: 'number' as const, label: 'Topic columns', min: 1, max: 4 },
  // R22I (T380): an icon from the catalog after the button's label; none keeps today's text-only button.
  buttonIcon: createIconPickerField('Button icon'),
  hideEmailLabel: createToggleField({ label: 'Hide the email label (screen readers still read it)' }),
  messages: {
    type: 'object' as const,
    label: 'Messages',
    objectFields: {
      pending: { type: 'textarea' as const, label: 'Confirmation email sent' },
      active: { type: 'textarea' as const, label: 'Subscribed' },
      consent: { type: 'text' as const, label: 'Consent missing' },
      email: { type: 'text' as const, label: 'Invalid email address' },
      topics: { type: 'text' as const, label: 'No topic chosen' },
      unavailable: { type: 'textarea' as const, label: 'Sign-up unavailable' },
      // Feature 169: shown only with attributes (`resolveFields`).
      fields: { type: 'text' as const, label: 'Required field missing' },
    },
  },
};

type MessagesField = { type: 'object'; objectFields: Record<string, unknown> };

// Per host `messages` field (the block's own, or the admin's translated copy): the same copy without `fields`.
const messagesWithoutFields = new WeakMap<object, MessagesField>();

/** The `messages` field without its `fields` message, the same object for the same host field (focus is kept). */
function withoutFieldsMessage(field: unknown): unknown {
  const host = field as MessagesField | undefined;
  if (!host || host.type !== 'object' || !host.objectFields || !('fields' in host.objectFields)) return field;
  let copy = messagesWithoutFields.get(host);
  if (!copy) {
    const { fields: _fields, ...rest } = host.objectFields;
    copy = { ...host, objectFields: rest };
    messagesWithoutFields.set(host, copy);
  }
  return copy;
}

const signupConfig: ComponentConfig<{ props: NewsletterSignupFormProps }> = {
  label: 'Newsletter sign-up',
  fields: SIGNUP_FIELDS as unknown as Fields<NewsletterSignupFormProps>,
  defaultProps: {
    heading: plainTextToInlineRichText('Stay in the loop'),
    headingLevel: 'h2',
    text: plainTextToDoc('News, offers and events, a few times a month.'),
    emailLabel: 'E-mail address',
    placeholder: 'you@example.com',
    buttonLabel: 'Subscribe',
    topicsLegend: 'Topics',
    topics: [],
    topicsRequired: false,
    consentLabel: DEFAULT_CONSENT_LABEL,
    layout: 'boxed',
    messages: { ...DEFAULT_MESSAGES },
  } as NewsletterSignupFormProps,
  // R19B (T252): the field's shape with the button inside it, the topics' columns with topics.
  resolveFields: (data, params) => {
    const props = data.props as NewsletterSignupFormProps;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? SIGNUP_FIELDS)) {
      if (key === 'fieldShape' && props.buttonPlacement !== 'inside') continue;
      if (key === 'topicsColumns' && (props.topics ?? []).length === 0) continue;
      // Feature 169: the "required field missing" message only with attributes.
      if (key === 'messages' && !(Array.isArray(props.attributes) && props.attributes.length > 0)) {
        fields[key] = withoutFieldsMessage(field);
        continue;
      }
      fields[key] = field;
    }
    return fields as unknown as Fields<NewsletterSignupFormProps>;
  },
  render: (props) =>
    props.puck?.isEditing ? <SignupEditingRender {...props} /> : <SignupPublishedRender {...props} />,
};

/**
 * The block, exported under its name's local segment (`newsletter.Signup`), as
 * every block of this package is: the SSR floor reconciles the components map
 * with the exported block configs by that segment.
 */
export const Signup = withHideOn(signupConfig);
