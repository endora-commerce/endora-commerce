/**
 * `POST /newsletter/subscribe` — the storefront handler behind the
 * `newsletter.Signup` Page Builder block (feature 163, FR-029; research R-17;
 * `specs/163-page-builder-marketing-pages/contracts/storefront-and-admin-api.md` §4).
 *
 * The block is a plain `<form method="post">`, so a sign-up works without
 * JavaScript: the handler answers `303` back to the page it came from, with the
 * outcome in `?newsletter=pending|active|error&reason=…` and the section's
 * anchor as the fragment. With JavaScript the block submits with
 * `Accept: application/json` and gets `{status}` or `{error}` instead.
 *
 * The subscription itself is the newsletter module's existing public endpoint,
 * reached through `subscribeNewsletter`; the consent is recorded there
 * (`consentAt` and the audit entry), and `source: 'cms-block'` tells this
 * sign-up apart from the others. While the newsletter module is absent the
 * handler answers `404`, as the block is already gone from every page.
 */

import { SECTION_ANCHOR_RE, newsletterSubscribeRequestSchema } from '@endora-commerce/contracts';
import { getModulePresence } from '../../../lib/api/module-presence';
import { subscribeNewsletter } from '../../../lib/api/newsletter';
import { SALES_CHANNEL_REQUEST_HEADER } from '../../../lib/channel/channel-header';

export const dynamic = 'force-dynamic';

/** A topic is a newsletter tag code. Anything else is dropped, not refused. */
const TOPIC_CODE_RE = /^[a-z0-9_-]{1,64}$/;
/** The most topics one sign-up carries; the block offers at most 12. */
const MAX_TOPICS = 12;

/** Feature 169 (FR-026): an attribute's key, as the newsletter's custom fields name them. */
const ATTRIBUTE_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
/** The most attributes one sign-up carries (the block offers at most 10). */
const MAX_ATTRIBUTES = 10;
/** The longest text value the newsletter keeps. */
const ATTRIBUTE_TEXT_MAX = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ATTRIBUTE_TYPES = ['text', 'number', 'boolean', 'date'] as const;
type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

type SignupError = 'consent' | 'email' | 'topics' | 'fields' | 'unavailable';
type SignupOutcome = { status: 'pending' | 'active' } | { error: SignupError };

/** The `email` rule the backend applies, so a refusal here is the one the backend would give. */
const emailRule = newsletterSubscribeRequestSchema.shape.email;

/**
 * A same-origin path, or `/`. Anything that could leave the storefront — an
 * absolute URL, `//host`, `/\host`, a scheme — falls back to the home page.
 */
function safeReturnTo(raw: string): URL {
  const base = 'http://storefront.invalid';
  const fallback = new URL('/', base);
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\\]/.test(raw)) return fallback;
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

/**
 * Feature 169 (US7, FR-026, data-model §4) — the sign-up's subscriber
 * attributes. The block posts one hidden `attrSpec` per attribute,
 * `<key>|<type>|<0|1 required>`, and the value as `attr.<key>`. Each value is
 * coerced by its type — a ticked box (`on`) is `true`, an unticked one
 * `false`; a number when finite; a date when `YYYY-MM-DD`; a text trimmed, at
 * most 500 characters — and anything else counts as not given. A required
 * attribute not given is `missing`. The newsletter module checks the types
 * again against its own field definitions and keeps only what matches.
 */
function attributesOf(form: FormData): { values: Record<string, string | number | boolean>; missing: boolean } {
  const values: Record<string, string | number | boolean> = {};
  let missing = false;
  const seen = new Set<string>();
  const specs = form.getAll('attrSpec').filter((spec): spec is string => typeof spec === 'string');
  for (const spec of specs.slice(0, MAX_ATTRIBUTES)) {
    const [key = '', type = '', required = ''] = spec.split('|');
    if (!ATTRIBUTE_KEY_RE.test(key) || !(ATTRIBUTE_TYPES as readonly string[]).includes(type) || seen.has(key)) continue;
    seen.add(key);
    const value = coerceAttribute(type as AttributeType, field(form, `attr.${key}`));
    if (value === undefined || (type === 'boolean' && value === false)) {
      if (required === '1') missing = true;
    }
    if (value !== undefined) values[key] = value;
  }
  return { values, missing };
}

function coerceAttribute(type: AttributeType, raw: string): string | number | boolean | undefined {
  if (type === 'boolean') return raw === 'on';
  const value = raw.trim();
  if (value === '') return undefined;
  if (type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === 'date') return DATE_RE.test(value) ? value : undefined;
  return value.length <= ATTRIBUTE_TEXT_MAX ? value : undefined;
}

function redirectTo(returnTo: URL, anchor: string | null, outcome: SignupOutcome): Response {
  const target = new URL(returnTo.href);
  target.searchParams.delete('newsletter');
  target.searchParams.delete('reason');
  if ('error' in outcome) {
    target.searchParams.set('newsletter', 'error');
    target.searchParams.set('reason', outcome.error);
  } else {
    target.searchParams.set('newsletter', outcome.status);
  }
  // A relative `Location`: the storefront may sit behind a proxy whose public
  // origin this request does not know, and the browser resolves it against the
  // page it posted from.
  const location = `${target.pathname}${target.search}${anchor ? `#${anchor}` : ''}`;
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

function json(outcome: SignupOutcome): Response {
  return Response.json(outcome, {
    status: 'error' in outcome ? 400 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  const modules = await getModulePresence();
  if (!modules.isPresent('newsletter')) {
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
  const answer = (outcome: SignupOutcome): Response =>
    wantsJson ? json(outcome) : redirectTo(returnTo, anchor, outcome);

  const email = emailRule.safeParse(field(form, 'email'));
  if (!email.success) return answer({ error: 'email' });
  if (field(form, 'consent') !== 'on') return answer({ error: 'consent' });

  const topics = [
    ...new Set(
      form
        .getAll('topics')
        .filter((value): value is string => typeof value === 'string' && TOPIC_CODE_RE.test(value)),
    ),
  ].slice(0, MAX_TOPICS);
  if (field(form, 'topicsRequired') === 'on' && topics.length === 0) return answer({ error: 'topics' });
  const attributes = attributesOf(form);
  if (attributes.missing) return answer({ error: 'fields' });

  const channelCode = request.headers.get(SALES_CHANNEL_REQUEST_HEADER) || 'default';
  try {
    const result = await subscribeNewsletter({
      email: email.data,
      channelCode,
      ...(topics.length > 0 ? { tags: topics } : {}),
      ...(Object.keys(attributes.values).length > 0 ? { customFields: attributes.values } : {}),
      source: 'cms-block',
    });
    return answer({ status: result.status });
  } catch {
    return answer({ error: 'unavailable' });
  }
}
