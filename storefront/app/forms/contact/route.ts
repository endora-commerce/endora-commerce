/**
 * `POST /forms/contact` — the storefront handler behind the `cms.ContactForm` Page Builder
 * block (`specs/169-page-builder-contact-form/` contracts/contact-form-api.md §3, FR-017,
 * FR-021, FR-022; research R-10).
 *
 * The block is a plain `<form method="post">`, so a message can be sent without JavaScript: the
 * handler answers `303` back to the page it came from, with the outcome in
 * `?contact=sent|error&reason=…&form=<block id>` and the section's anchor as the fragment. With
 * JavaScript the block submits with `Accept: application/json` and gets `{status}` or `{error}`.
 *
 * The handler checks the block's own "required" switches (the backend knows only its minimum —
 * an e-mail, a message and the privacy consent) and the shared contract, then calls the `cms`
 * module's public endpoint, which e-mails the channel's recipients and stores nothing. With the
 * marketing consent ticked and the newsletter module present, the address is also subscribed
 * through the newsletter's existing public endpoint (`source: 'cms-contact-form'`), so the
 * channel's opt-in mode applies; that step never changes the answer. While `cms` is absent the
 * handler answers `404`, as the block is already gone from every page.
 */

import {
  SECTION_ANCHOR_RE,
  contactFormSubmissionSchema,
  type ContactFormSubmission,
} from '@endora-commerce/contracts';
import { getModulePresence } from '../../../lib/api/module-presence';
import { submitContactForm, type ContactFormOutcome } from '../../../lib/api/contact-form';
import { subscribeNewsletter } from '../../../lib/api/newsletter';
import { SALES_CHANNEL_REQUEST_HEADER } from '../../../lib/channel/channel-header';

export const dynamic = 'force-dynamic';

type ContactError = Exclude<ContactFormOutcome, 'sent'>;
type Outcome = { status: 'sent' } | { error: ContactError };

/** The fields a block may mark as required beyond the backend's minimum. */
const OPTIONAL_KEYS = ['name', 'phone', 'company', 'subject', 'choice'] as const;
type OptionalKey = (typeof OPTIONAL_KEYS)[number];

/** A block id as the Page Builder writes it. */
const FORM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The query keys this handler owns on the page it returns to. */
const OUTCOME_KEYS = ['contact', 'reason', 'form'] as const;

/**
 * A same-origin path, or `/`. Anything that could leave the storefront — an absolute URL,
 * `//host`, `/\host`, a scheme — falls back to the home page.
 */
function safeReturnTo(raw: string): URL {
  const base = 'http://storefront.invalid';
  const fallback = new URL('/', base);
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || raw[index] === '\\') return fallback;
  }
  try {
    const url = new URL(raw, base);
    return url.origin === base ? url : fallback;
  } catch {
    return fallback;
  }
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function redirectTo(returnTo: URL, formId: string | null, anchor: string | null, outcome: Outcome): Response {
  const target = new URL(returnTo.href);
  for (const key of OUTCOME_KEYS) target.searchParams.delete(key);
  if ('error' in outcome) {
    target.searchParams.set('contact', 'error');
    target.searchParams.set('reason', outcome.error);
  } else {
    target.searchParams.set('contact', 'sent');
  }
  if (formId) target.searchParams.set('form', formId);
  // A relative `Location`: the storefront may sit behind a proxy whose public origin this
  // request does not know, and the browser resolves it against the page it posted from.
  const location = `${target.pathname}${target.search}${anchor ? `#${anchor}` : ''}`;
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

function json(outcome: Outcome): Response {
  return Response.json(outcome, {
    status: 'error' in outcome ? 400 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** The block's required keys, those it may name only. */
function requiredKeys(form: FormData): Set<OptionalKey> {
  const keys = new Set<OptionalKey>();
  for (const value of form.getAll('required')) {
    if (typeof value === 'string' && (OPTIONAL_KEYS as readonly string[]).includes(value)) keys.add(value as OptionalKey);
  }
  return keys;
}

export async function POST(request: Request): Promise<Response> {
  const modules = await getModulePresence();
  if (!modules.isPresent('cms')) {
    return new Response('Not Found', { status: 404 });
  }

  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    form = new FormData();
  }

  const returnTo = safeReturnTo(field(form, 'returnTo'));
  const rawAnchor = field(form, 'anchor');
  const anchor = SECTION_ANCHOR_RE.test(rawAnchor) ? rawAnchor : null;
  const rawFormId = field(form, 'form');
  const formId = FORM_ID_RE.test(rawFormId) ? rawFormId : null;
  const answer = (outcome: Outcome): Response =>
    wantsJson ? json(outcome) : redirectTo(returnTo, formId, anchor, outcome);

  for (const key of requiredKeys(form)) {
    if (field(form, key).trim() === '') return answer({ error: 'invalid' });
  }

  const choice = field(form, 'choice');
  const marketingConsent = field(form, 'marketingConsent') === 'on';
  const parsed = contactFormSubmissionSchema.safeParse({
    email: field(form, 'email'),
    message: field(form, 'message'),
    // Anything but a ticked box is absent, and the contract refuses it.
    ...(field(form, 'privacyConsent') === 'on' ? { privacyConsent: true } : {}),
    marketingConsent,
    name: field(form, 'name'),
    phone: field(form, 'phone'),
    company: field(form, 'company'),
    subject: field(form, 'subject'),
    // The select's label goes only with a picked option.
    choiceLabel: choice.trim() !== '' ? field(form, 'choiceLabel') : '',
    choice,
    pagePath: returnTo.pathname,
    // The honeypot travels only when a bot filled it; the backend answers it as sent.
    ...(field(form, 'website') !== '' ? { website: field(form, 'website') } : {}),
  });
  if (!parsed.success) return answer({ error: 'invalid' });
  const submission: ContactFormSubmission = withoutEmptyKeys(parsed.data);

  const channelCode = request.headers.get(SALES_CHANNEL_REQUEST_HEADER) || 'default';
  let outcome: ContactFormOutcome;
  try {
    outcome = await submitContactForm({
      submission,
      channelCode,
      forwardedFor: request.headers.get('x-forwarded-for'),
    });
  } catch {
    outcome = 'unavailable';
  }
  if (outcome !== 'sent') return answer({ error: outcome });

  // FR-021 — the decoupled newsletter opt-in. A filled honeypot was answered `sent` without a
  // message, and is not subscribed either.
  if (marketingConsent && !submission.website && modules.isPresent('newsletter')) {
    try {
      await subscribeNewsletter({ email: submission.email, channelCode, source: 'cms-contact-form' });
    } catch (err) {
      console.warn('[forms/contact] newsletter subscription failed', err instanceof Error ? err.message : err);
    }
  }
  return answer({ status: 'sent' });
}

/** The parsed submission without the keys an empty field left `undefined`. */
function withoutEmptyKeys(value: ContactFormSubmission): ContactFormSubmission {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as ContactFormSubmission;
}
