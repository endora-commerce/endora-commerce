'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ButtonSpec } from '@endora-commerce/page-builder-core';
import type { AvailablePublicFormDefinition, FormFieldErrorCode, PublicFormField } from '@endora-commerce/contracts';
import type { FormBlockProps } from '../../schema/component-types.js';
import type { FormBlockData } from '../../utils/catalog-preview-bridge.js';
import { ButtonView } from '../ButtonView.js';
import { useSectionAnchor } from '../Section.js';
import { useBlockDomId } from '../block-dom-id.js';
import { sanitizeRichHtml } from '../rich-content-shared.js';
import {
  useCmsRenderForms,
  useCmsRenderLocalizePath,
  useCmsRenderLocation,
  type CmsFormsContext,
  type CmsFormsText,
} from '../render-context.js';
import { CAPTCHA_CONTAINER_CLASSES, mountCaptcha, resetCaptcha } from './captcha-loader.js';
import { FormErrorSummary } from './FormErrorSummary.js';
import { FormField } from './FormField.js';
import {
  FORMS_SUBMIT_PATH,
  formsHasRules,
  formsInitialValues,
  formsOutcomeFromLocation,
  formsRefusalText,
  formsReturnPathOf,
  formsValuesOf,
  formsVisibility,
  navigateTo,
  readFormsJsonAnswer,
  type FormsFieldError,
  type FormsOutcome,
} from './form-block-state.js';

/**
 * `forms.Form` — a published form of the `forms` module placed on a page
 * (`specs/170-forms-module/` contracts/blocks-and-storefront.md §5, research R-8, R-28).
 *
 * The block **renders a public form definition**: the sections in a grid of their columns, each
 * field across its width (one column below the narrow breakpoint, FR-016), the hidden fields' values
 * from the page context the storefront computed on the server, the honeypot, and the submit button
 * through the button look of every other button. It is synchronous and reads nothing but its props
 * and the CMS render context, so the whole form is in the server HTML (Principle VII).
 *
 * **Without JavaScript** it is a plain `<form method="post">` to the page language's
 * `/forms/submit`, carrying the form, this block's id, the page to come back to and the section's
 * anchor; the handler answers `303` back here with the outcome on the URL, addressed to this block
 * (US2-7), and a refused attempt's answers and errors come back through the render context
 * (research R-10). **With JavaScript** the same post is sent with `Accept: application/json` and the
 * outcome is shown in place — the typed answers stay, as the inputs are the shopper's (US2-6).
 *
 * **Conditional logic** (User Story 3, research R-28): the server render evaluates every rule over
 * the defaults (or a refused attempt's answers) with the contracts evaluator and gives a hidden
 * element the `hidden` attribute, so a shopper with JavaScript sees the right first state with no
 * layout shift; a `<noscript>` style reveals every conditional element to a browser without it,
 * whose answers the server judges by the same rules. With JavaScript the rules are evaluated again
 * on every change. A refusal focuses the summary, then the first refused field (FR-069).
 *
 * A form that takes no entry shows its message instead (closed, not yet open, full, sign in) or
 * nothing at all (unavailable, US2-3). In the editor, a note says why a form is not shown.
 *
 * **CAPTCHA** (User Story 6, FR-042): when the public read carries `captcha`, the provider's
 * container is rendered inside the form and its script is requested in an effect, once per page
 * (`captcha-loader.ts`) — never for a form that is not shown, and never in the editor, which has no
 * page. A browser without JavaScript is told the form needs it (OQ-2); a refusal resets the widget,
 * as a token is good for one check.
 *
 * The look follows the section's colour scheme: three field looks, three sizes and two
 * alignments, as classes — no colour and no pixel of its own (FR-005).
 */

/** The English built-ins, where the page provides none (the editor). */
export const FORMS_ENGLISH_TEXT: CmsFormsText = {
  submit: 'Send',
  required: '(required)',
  optional: '(optional)',
  errorSummary: 'There is a problem',
  errorSummaryCount: '{n} fields need your attention',
  accepted: 'Thank you. Your answers have been sent.',
  unavailable: 'This form cannot be sent right now. Please try again later.',
  rateLimited: 'Too many attempts. Please wait a few minutes and try again.',
  tooLarge: 'Your answers are too long to send. Please shorten them and try again.',
  captchaFailed: 'We could not verify that you are not a robot. Please try again.',
  captchaUnavailable: 'The verification service is not reachable. Please try again in a moment.',
  needsJavaScript: 'This form needs JavaScript to verify that you are not a robot.',
  truncatedAnswers: 'Some of your answers could not be kept and must be entered again.',
  closed: 'This form is closed.',
  notYetOpen: 'This form is not open yet.',
  full: 'This form has received the maximum number of answers.',
  signIn: 'Please sign in to use this form.',
  signInLink: 'Sign in',
  selectPlaceholder: 'Choose…',
  countryPlaceholder: 'Choose a country…',
  fieldErrors: {
    required: 'This field is required.',
    invalid_email: 'Enter a valid e-mail address.',
    invalid_phone: 'Enter a valid phone number.',
    invalid_number: 'Enter a number.',
    too_short: 'This answer is too short.',
    too_long: 'This answer is too long.',
    below_min: 'This number is too small.',
    above_max: 'This number is too large.',
    step_mismatch: 'This number is not allowed.',
    invalid_date: 'Enter a valid date.',
    too_early: 'This date is too early.',
    too_late: 'This date is too late.',
    too_few: 'Choose more options.',
    too_many: 'Choose fewer options.',
    unknown_option: 'Choose one of the options.',
    pattern: 'This answer is not in the expected format.',
    single_line: 'Write this answer on one line.',
    invalid_country: 'Choose a country from the list.',
    consent_required: 'Please agree to continue.',
  },
  addressParts: { street: 'Street and number', line2: 'Address line 2', postalCode: 'Postal code', city: 'City', country: 'Country' },
};

const LOOKS = ['boxed', 'underline', 'pill'] as const;
const SIZES = ['s', 'm', 'l'] as const;
const ALIGNS = ['start', 'center'] as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

/** A hidden field's value: the page context the storefront computed, or the static value. */
function hiddenValue(field: Extract<PublicFormField, { type: 'hidden' }>, context: CmsFormsContext | undefined): string {
  switch (field.source) {
    case 'static':
      return field.staticValue ?? '';
    case 'page_url':
      return context?.pageContext.pageUrl ?? '';
    case 'page_title':
      return context?.pageContext.pageTitle ?? '';
    case 'referrer':
      return context?.pageContext.referrer ?? '';
    case 'query_param':
      return field.paramName ? (context?.pageContext.query[field.paramName] ?? '') : '';
  }
}

export interface FormBlockRenderProps extends FormBlockProps {
  /** Puck's block id: the base of every element id, and how an outcome addresses this block. */
  id?: string;
  /** The read of the form — the public one, with the editor's note in the editor — or `null`. */
  definition: FormBlockData | null;
}

type Fields = AvailablePublicFormDefinition['sections'][number]['fields'];
type HiddenField = Extract<PublicFormField, { type: 'hidden' }>;

/** The DOM id a refused answer's summary entry links to: its control, or its address part. */
function targetIdOf(fields: Fields, fieldKey: string, domIdOf: (elementId: string) => string): string | null {
  const [key, part] = fieldKey.split('.');
  const field = fields.find((candidate) => 'key' in candidate && candidate.key === key);
  if (!field) return null;
  return part ? `${domIdOf(field.id)}-${part}` : domIdOf(field.id);
}

/**
 * The control a refusal moves focus to (FR-069): the first refused answer in the form's order, not
 * the order the server listed them in.
 */
function firstRefusedTargetId(
  fields: Fields,
  errors: readonly FormsFieldError[],
  domIdOf: (elementId: string) => string,
): string | null {
  for (const field of fields) {
    if (!('key' in field)) continue;
    const error = errors.find((candidate) => candidate.fieldKey === field.key || candidate.fieldKey.startsWith(`${field.key}.`));
    if (error) return targetIdOf(fields, error.fieldKey, domIdOf);
  }
  return null;
}

/**
 * The style a browser without JavaScript applies: every element hidden by a rule is shown, as the
 * server — not the page — applies the rules to what it receives (R-28).
 */
const NO_SCRIPT_REVEAL = '.cmsc-pb-form [data-cmsc-form-conditional][hidden]{display:block !important}';

/** A refused answer's words: the server's, else the built-in sentence for its code. */
function messageOf(error: FormsFieldError, text: CmsFormsText): string {
  if (error.message) return error.message;
  return text.fieldErrors[error.code as FormFieldErrorCode] ?? text.fieldErrors.required;
}

/** The attributes of an element with a rule: marked for the no-JS reveal, hidden while it fails. */
function conditional(hasRule: boolean, shown: boolean): { 'data-cmsc-form-conditional'?: ''; hidden?: true } {
  if (!hasRule) return {};
  return shown ? { 'data-cmsc-form-conditional': '' } : { 'data-cmsc-form-conditional': '', hidden: true };
}

function EditorNote({ message }: { message: string }): ReactNode {
  return (
    <p className="cmsc-pb-form__note" role="note">
      {message}
    </p>
  );
}

export function FormBlock({
  id,
  definition,
  fieldLook,
  size,
  align,
  buttonLook,
  showTitle = true,
  showDescription = true,
}: FormBlockRenderProps): ReactNode {
  const forms = useCmsRenderForms();
  const text = forms?.text ?? FORMS_ENGLISH_TEXT;
  const blockId = id ?? '';
  const baseId = useBlockDomId('pb-form', id);
  const location = useCmsRenderLocation();
  const localizePath = useCmsRenderLocalizePath();
  const anchor = useSectionAnchor();
  const attempt = forms?.attempt && forms.attempt.blockId === blockId ? forms.attempt : null;
  const [outcome, setOutcome] = useState<FormsOutcome>(() => formsOutcomeFromLocation(location, blockId, attempt));
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  /** A refusal to move focus for: the summary, then `target` — the first refused control, if any. */
  const [focusRequest, setFocusRequest] = useState<{ target: string | null } | null>(null);
  const available = definition && definition.availability !== 'unavailable' ? definition : null;
  const [values, setValues] = useState(() =>
    available
      ? formsInitialValues(available.sections, (field) => hiddenValue(field, forms), attempt?.answers)
      : {},
  );
  const visible = useMemo(() => (available ? formsVisibility(available, values) : null), [available, values]);
  const [returnTo, setReturnTo] = useState(() =>
    localizePath(location ? formsReturnPathOf(location.path, location.query) : '/'),
  );
  const captchaRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<unknown>(undefined);
  // The widget only where the form itself is shown, and only on a page (the editor has no context).
  const showsForm =
    available !== null &&
    available.availability === 'open' &&
    !(available.signedInOnly && forms && !forms.viewerSignedIn) &&
    outcome?.kind !== 'accepted';
  const captcha = showsForm && forms && available.captcha ? available.captcha : null;
  const captchaProvider = captcha?.provider;
  const captchaSiteKey = captcha?.siteKey;

  useEffect(() => {
    if (!captchaProvider || captchaSiteKey === undefined) return;
    widgetRef.current = mountCaptcha(captchaProvider, captchaSiteKey, captchaRef.current);
  }, [captchaProvider, captchaSiteKey]);

  useEffect(() => {
    if (!location && typeof window !== 'undefined') {
      setReturnTo(
        formsReturnPathOf(window.location.pathname, Object.fromEntries(new URLSearchParams(window.location.search))),
      );
    }
  }, [location]);

  useEffect(() => {
    if (!focusRequest) return;
    setFocusRequest(null);
    // The summary first, so its title and list are read; then the first field to correct.
    summaryRef.current?.focus();
    if (focusRequest.target) document.getElementById(focusRequest.target)?.focus();
  }, [focusRequest]);

  const note = definition?.editorNote ? <EditorNote message={definition.editorNote.message} /> : null;
  if (!definition || definition.availability === 'unavailable') return note;

  const rootClass = [
    'cmsc-pb-form',
    `cmsc-pb-form--look-${oneOf(fieldLook, LOOKS, 'boxed')}`,
    `cmsc-pb-form--size-${oneOf(size, SIZES, 'm')}`,
    `cmsc-pb-form--align-${oneOf(align, ALIGNS, 'start')}`,
  ].join(' ');
  const title = showTitle ? definition.texts.title : undefined;
  const description = showDescription ? definition.texts.description : undefined;
  const header =
    title || description ? (
      <div className="cmsc-pb-form__header">
        {title ? <h2 className="cmsc-pb-form__title">{title}</h2> : null}
        {description ? <p className="cmsc-pb-form__description">{description}</p> : null}
      </div>
    ) : null;
  const shell = (children: ReactNode): ReactNode => (
    <div className={rootClass}>
      {note}
      {header}
      {children}
    </div>
  );

  // A form that takes no entry now: its message, never the form (US2-3).
  if (definition.availability !== 'open') {
    const message =
      definition.availability === 'closed'
        ? (definition.texts.closed ?? text.closed)
        : definition.availability === 'not_yet_open'
          ? (definition.texts.notYetOpen ?? text.notYetOpen)
          : (definition.texts.full ?? text.full);
    return shell(
      <p className="cmsc-pb-form__message" role="status">
        {message}
      </p>,
    );
  }

  // Signed-in customers only, and this visitor is not one (US6-7). The editor has no viewer.
  if (definition.signedInOnly && forms && !forms.viewerSignedIn) {
    return shell(
      <p className="cmsc-pb-form__message">
        {definition.texts.signIn ?? text.signIn}{' '}
        <a href={localizePath(forms.signInPath)}>{text.signInLink}</a>
      </p>,
    );
  }

  // Accepted: the confirmation message in place of the form.
  if (outcome?.kind === 'accepted') {
    const own = outcome.message || definition.texts.success;
    return shell(
      <div className="cmsc-pb-form__message cmsc-pb-form__message--accepted" role="status">
        {own ? <div dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(own) }} /> : <p>{text.accepted}</p>}
      </div>,
    );
  }

  const allFields = definition.sections.flatMap((section) => section.fields);
  const domIdOf = (elementId: string): string => `${baseId}-${elementId}`;
  const refused = outcome?.kind === 'refused' ? outcome : null;
  const fieldErrors = refused?.fields ?? [];
  const errorsByKey = Object.fromEntries(fieldErrors.map((error) => [error.fieldKey, messageOf(error, text)]));
  const summary = fieldErrors.flatMap((error) => {
    const targetId = targetIdOf(allFields, error.fieldKey, domIdOf);
    return targetId ? [{ targetId, message: messageOf(error, text) }] : [];
  });
  const refusal =
    refused && refused.reason !== 'invalid'
      ? formsRefusalText(text, refused.reason, refused.notAccepting, definition.texts)
      : refused && summary.length === 0
        ? text.unavailable
        : null;
  const hiddenFields = allFields.filter((field): field is HiddenField => field.type === 'hidden');
  const action = localizePath(FORMS_SUBMIT_PATH);
  const button = {
    style: 'primary',
    fill: 'solid',
    size: 'medium',
    ...(buttonLook ?? {}),
    label: definition.texts.submitLabel ?? text.submit,
  } as ButtonSpec;
  const posted = attempt?.answers;
  const hasRules = formsHasRules(definition);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(event.currentTarget),
      });
      const answer = readFormsJsonAnswer(await response.json().catch(() => null));
      if (answer.kind !== 'accepted') {
        if (captcha) resetCaptcha(captcha.provider, widgetRef.current);
        setOutcome(answer);
        setFocusRequest({ target: firstRefusedTargetId(allFields, answer.fields, domIdOf) });
      } else if (answer.confirmation.type === 'redirect') {
        navigateTo(answer.confirmation.url);
      } else if (answer.confirmation.type === 'page') {
        navigateTo(localizePath(answer.confirmation.path));
      } else {
        setOutcome({ kind: 'accepted', message: answer.confirmation.message });
      }
    } catch {
      if (captcha) resetCaptcha(captcha.provider, widgetRef.current);
      setOutcome({ kind: 'refused', reason: 'unavailable', fields: [] });
      setFocusRequest({ target: null });
    } finally {
      setBusy(false);
    }
  }

  return shell(
    <form
      className="cmsc-pb-form__form"
      method="post"
      action={action}
      noValidate
      aria-busy={busy || undefined}
      onChange={(event) => setValues(formsValuesOf(event.currentTarget))}
      onSubmit={(event) => void onSubmit(event)}
      {...(title ? { 'aria-label': title } : {})}
    >
      <input type="hidden" name="formId" value={definition.formId} />
      {blockId ? <input type="hidden" name="blockId" value={blockId} /> : null}
      <input type="hidden" name="returnTo" value={returnTo} />
      {anchor ? <input type="hidden" name="anchor" value={anchor} /> : null}
      {hiddenFields.map((field) => (
        <input key={field.id} type="hidden" name={field.key} value={hiddenValue(field, forms)} />
      ))}
      <div className="cmsc-pb-form__hp" aria-hidden="true">
        <input type="text" name="hp_extra" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      {refusal ? (
        <div ref={summaryRef} className="cmsc-pb-form__summary" role="alert" tabIndex={-1}>
          <p className="cmsc-pb-form__summary-title">{refusal}</p>
        </div>
      ) : (
        <FormErrorSummary id={`${baseId}-summary`} title={text.errorSummary} errors={summary} ref={summaryRef} />
      )}
      {attempt?.truncated ? <p className="cmsc-pb-form__message">{text.truncatedAnswers}</p> : null}
      {hasRules ? (
        <noscript>
          <style>{NO_SCRIPT_REVEAL}</style>
        </noscript>
      ) : null}
      {definition.sections.map((section) => {
        const fields = section.fields.filter((field) => field.type !== 'hidden');
        if (fields.length === 0 && !section.title && !section.description) return null;
        return (
          <div
            key={section.id}
            id={domIdOf(section.id)}
            className="cmsc-pb-form__section"
            {...conditional(section.visibility !== undefined, visible?.sections.has(section.id) ?? true)}
          >
            {section.title ? <h3 className="cmsc-pb-form__section-title">{section.title}</h3> : null}
            {section.description ? <p className="cmsc-pb-form__section-description">{section.description}</p> : null}
            <div className={`cmsc-pb-form__grid cmsc-pb-form__grid--cols-${section.columns}`}>
              {fields.map((field) => (
                <div
                  key={field.id}
                  className={`cmsc-pb-form__cell cmsc-pb-form__cell--span-${Math.min(field.width, section.columns)}`}
                  {...conditional(field.visibility !== undefined, visible?.fields.has(field.id) ?? true)}
                >
                  <FormField
                    field={field as Exclude<PublicFormField, { type: 'hidden' }>}
                    domId={domIdOf(field.id)}
                    text={text}
                    countries={forms?.countries ?? []}
                    errors={errorsByKey}
                    values={posted}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {captcha ? (
        <>
          <div
            ref={captchaRef}
            className={`cmsc-pb-form__captcha ${CAPTCHA_CONTAINER_CLASSES[captcha.provider]}`}
            data-sitekey={captcha.siteKey}
          />
          <noscript>
            <p className="cmsc-pb-form__message">{text.needsJavaScript}</p>
          </noscript>
        </>
      ) : null}
      <div className="cmsc-pb-form__actions">
        <ButtonView button={button} type="submit" />
      </div>
    </form>,
  );
}
