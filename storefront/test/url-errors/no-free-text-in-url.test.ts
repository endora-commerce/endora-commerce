import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Issue #790 — a URL carries a code and validated typed values, never free text
 * (`specs/conventions/module-i18n.md`). `no-sentence-in-url.test.ts` watches the
 * three message parameters by name; this net watches every query parameter the
 * storefront **builds** from a value — in `app/`, `components/` and `lib/`
 * (not `lib/api/` or `lib/dictionary/`, which build requests to the backend,
 * not addresses a buyer lands on) — whether as a `?name=${…}` template, an
 * `encodeURIComponent`, a `new URLSearchParams({ … })` key, a `.set('name', …)`
 * on a `URLSearchParams` or a `URL`'s `searchParams` — and refuses any name not
 * on the allow-list below. `?listAdded=` (a shopping list's name) and
 * `?preview=` (the quick-order CSV) are the two this net was written against.
 *
 * Its declared limits: the allow-list is **by name**, so it is a promise about
 * a parameter's value, not a proof — the per-page tests in this directory are
 * the evidence that a crafted value never reaches the screen; and a code built
 * into a template (`?error=${code}`) is not trusted by its name: the source
 * must prove it is one — a vocabulary call, a literal, or an entry on the short
 * `CODE_IN_TEMPLATE` list (issue #810). That proof is textual, so a listed
 * identifier is only as good as the type it was read to have. A new parameter
 * must justify itself here.
 */

const ROOT = resolve(import.meta.dirname, '../..');
const SCANNED = ['app', 'components', 'lib'];
const NOT_SCANNED = new Set(['lib/api', 'lib/dictionary']);

type Kind = 'code' | 'id' | 'number' | 'structured' | 'path' | 'query';

/**
 * The parameters known to be safe, and why. `code` values are fixed ASCII
 * tokens a page words from its own vocabulary and drops when it does not know
 * them (`lib/url-errors.ts`); `id` values are looked up or never printed;
 * `number` values are parsed as numbers; `structured` values are ids, codes and
 * numbers in a fixed shape, re-validated field by field on read; `path` is an
 * in-site return path the login flow validates. `query` is the **one named
 * exception** to "no free text": the search text the buyer typed themselves,
 * capped where the page reads it and shown only as the quoted query or an
 * input's value.
 */
const SAFE: Record<string, { kind: Kind; why: string }> = {
  // Codes — the page words them; an unknown one shows nothing or the generic failure.
  error: { kind: 'code', why: 'a page vocabulary code (issue #745)' },
  reason: { kind: 'code', why: 'a contact/newsletter outcome code' },
  problem: { kind: 'code', why: 'a quick-order vocabulary code' },
  couponError: { kind: 'code', why: 'a coupon refusal code' },
  formsReason: { kind: 'code', why: 'a form-submission outcome code' },
  newsletter: { kind: 'code', why: 'a newsletter sign-up outcome code' },
  status: { kind: 'code', why: 'an outcome code (`pending` / `active` / `error`, `created` / `removed` / `default`)' },
  outcome: { kind: 'code', why: 'a payment-return outcome code, read through `parseReturnOutcome`' },
  // Ids and tokens — looked up server-side, or never printed.
  id: { kind: 'id', why: 'an order id the page looks up' },
  orderId: { kind: 'id', why: 'an order id the page looks up' },
  rfqId: { kind: 'id', why: 'a quote-request id the page looks up' },
  listAdded: { kind: 'id', why: 'a shopping-list id; the page reads the name of the buyer’s own list (issue #790)' },
  qtyError: { kind: 'id', why: 'the shopping-list line id the refusal sits beside' },
  errorItem: { kind: 'id', why: 'the cart line id the refusal sits beside' },
  variant: { kind: 'id', why: 'a variant SKU the product page matches against its own variants' },
  cursor: { kind: 'id', why: 'an opaque pagination cursor the API reads' },
  salesChannel: { kind: 'code', why: 'the sales-channel code on the OAuth start link, which the backend resolves' },
  v: { kind: 'id', why: 'the build version the service-worker URL is keyed by, never printed' },
  l: { kind: 'id', why: 'the GTM snippet’s own dataLayer name (`dataLayer`)' },
  token: { kind: 'id', why: 'an opaque verification or reset token, never printed' },
  form: { kind: 'id', why: 'a contact-form block id' },
  formsBlock: { kind: 'id', why: 'a form block id' },
  formsAttempt: { kind: 'id', why: 'a form-submission attempt id' },
  cartSkips: {
    kind: 'structured',
    why: 'item/product ids, reason codes and minimums — no names — re-validated field by field on read (`lib/batchReport.ts`)',
  },
  rfqSkips: {
    kind: 'structured',
    why: 'the quote-request conversion’s skips, in the `cartSkips` shape and through the same reader (`lib/batchReport.ts`; #1161)',
  },
  // Numbers.
  page: { kind: 'number', why: 'a page number' },
  attempt: { kind: 'number', why: 'a payment-status poll attempt, parsed as a number' },
  min: {
    kind: 'number',
    why: 'a minimum quantity, written and read only as `^[1-9]\\d{0,8}$` (`lib/url-typed-values.ts`; #783, #791)',
  },
  typed: {
    kind: 'number',
    why: 'the quantity the buyer typed, read only when it matches `^[1-9]\\d{0,8}$` (the `min=` rule from #783)',
  },
  sent: { kind: 'number', why: 'a line count' },
  rejected: { kind: 'number', why: 'a line count' },
  cartAdded: { kind: 'number', why: 'a line count' },
  cartSkipped: { kind: 'number', why: 'a line count' },
  rfqAdded: { kind: 'number', why: 'a line count' },
  rfqSkipped: { kind: 'number', why: 'a line count' },
  members: { kind: 'number', why: 'a member count' },
  invitations: { kind: 'number', why: 'an invitation count' },
  couponShortfall: {
    kind: 'number',
    why: 'a decimal amount, written and read only through `lib/url-typed-values.ts` (#791)',
  },
  couponShortfallCurrency: {
    kind: 'code',
    why: 'an ISO 4217 currency code, written and read only as `^[A-Z]{3}$` (`lib/url-typed-values.ts`; #791)',
  },
  // Issue #791 — the figures of a `LIMIT_INSUFFICIENT` refusal, beside its code (`lib/url-error-figures.ts`).
  available: {
    kind: 'number',
    why: 'the credit limit still available, a decimal amount written and read only through `lib/url-typed-values.ts`',
  },
  total: { kind: 'number', why: 'the refused order’s total, a decimal amount written and read only through `lib/url-typed-values.ts`' },
  // Issue #832 — the figures of an `ORDER_BELOW_MINIMUM_VALUE` refusal, beside its code; `currency` is shared.
  minValue: {
    kind: 'number',
    why: 'the store’s minimum order value, a two-place display amount written and read only through `lib/url-typed-values.ts`',
  },
  subtotal: {
    kind: 'number',
    why: 'the refused order’s subtotal, a two-place display amount written and read only through `lib/url-typed-values.ts`',
  },
  currency: {
    kind: 'code',
    why: 'the ISO 4217 code of the amounts beside it, written and read only as `^[A-Z]{3}$` (`lib/url-typed-values.ts`)',
  },
  // A path and a query.
  next: { kind: 'path', why: 'an in-site return path; the login flow refuses anything else' },
  q: {
    kind: 'query',
    why: 'the named exception: the buyer’s own search text, capped where the page reads it, shown only as the quoted query or an input value',
  },
};

/**
 * Sites that still put free text into a URL — the list only shrinks. Each is a
 * `file:parameter` pair this net found and the fix for issue #790 did not
 * cover; see the pull request for the follow-up.
 */
const KNOWN_FREE_TEXT = new Set<string>([]);

interface Site {
  file: string;
  name: string;
  /** Built through `URLSearchParams` — the value is encoded, so a code is indistinguishable from a sentence. */
  encoded: boolean;
  /** The value is a string literal, so it is fixed text the source chose. */
  literal: boolean;
  /** The expression inside a `?name=${…}` template, when the site is one. */
  value?: string | undefined;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (NOT_SCANNED.has(relative(ROOT, path).split('\\').join('/'))) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const LITERAL = /^\s*(?:'[^']*'|"[^"]*"|`[^`$]*`)\s*$/;

/** `cond ? 'A' : 'B'` — a choice between literals is as fixed as one literal. */
const LITERAL_CHOICE = /^\s*(?:'[^']*'|"[^"]*"|[^?'"`]+\?\s*(?:'[^']*'|"[^"]*")\s*:\s*(?:'[^']*'|"[^"]*"))\s*$/;

/** The expression of the `${…}` opened just before `start`, read to its balanced `}`. */
function templateValue(source: string, start: number): string | undefined {
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i).trim();
  }
  return undefined;
}

function sitesOf(file: string, source: string): Site[] {
  const sites: Site[] = [];
  for (const m of source.matchAll(/[?&]([A-Za-z_]\w*)=(?:\$\{|'\s*\+)/g)) {
    const value = m[0].endsWith('${') ? templateValue(source, m.index + m[0].length) : undefined;
    sites.push({ file, name: m[1]!, encoded: false, literal: value !== undefined && LITERAL_CHOICE.test(value), value });
  }
  for (const m of source.matchAll(/new URLSearchParams\(\s*\{([^}]*)\}/g)) {
    // `key: value` or the shorthand `{ key }`, whose value is the variable of that name.
    for (const entry of m[1]!.matchAll(/(?:^|,)\s*(?:['"]?([A-Za-z_]\w*)['"]?\s*:\s*([^,]+)|([A-Za-z_]\w*)\s*(?=,|$))/g)) {
      const name = entry[1] ?? entry[3]!;
      sites.push({ file, name, encoded: true, literal: entry[2] !== undefined && LITERAL.test(entry[2]) });
    }
  }
  const builders = [...source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*new URLSearchParams\(/g)].map((m) => m[1]!);
  for (const m of source.matchAll(/(\w+(?:\.searchParams)?)\.(?:set|append)\(\s*['"]([A-Za-z_]\w*)['"]\s*,\s*([^)]*)\)/g)) {
    if (!m[1]!.endsWith('.searchParams') && !builders.includes(m[1]!)) continue;
    sites.push({ file, name: m[2]!, encoded: true, literal: LITERAL.test(m[3]!) });
  }
  return sites;
}

/**
 * Code parameters built through `URLSearchParams` from a variable, each read
 * and confirmed to carry a code — the net cannot tell that from the source.
 */
const CODE_THROUGH_SEARCH_PARAMS = new Set<string>([
  'app/(commerce)/cart/page.tsx:couponError', // `result.reason`, the coupon refusal code
  'app/forms/contact/route.ts:reason', // `outcome.error`, a contact outcome code
  'app/(commerce)/cart/page.tsx:couponShortfallCurrency', // `writeCurrency(…)`, an ISO 4217 code or nothing (#791)
  'lib/url-error-figures.ts:currency', // `writeCurrency(…)`, an ISO 4217 code or nothing (#791)
  'app/newsletter/subscribe/route.ts:reason', // `outcome.error`, a newsletter outcome code
  'app/newsletter/subscribe/route.ts:newsletter', // `outcome.status`, a newsletter outcome code
  'app/forms/submit/route.ts:formsReason', // `outcome.reason`, a submission outcome code
  'lib/cartMinimum.ts:error', // `code`, a `CART_ERRORS` code (`cartLineEditErrorHref`)
]);

/**
 * Issue #810 — the calls that prove a template-built code value is a code: a
 * `defineUrlErrors` vocabulary's `failureCode` (`lib/url-errors.ts`), the
 * sign-in vocabulary's `signInErrorParam` (`lib/auth/sign-in-errors.ts`), and
 * the per-page code mappers, each read and confirmed to return a closed union
 * (`memberFailureCode` a `MemberErrorCode`, `parseRejectReason` a
 * `'REASON_REQUIRED' | 'REASON_TOO_LONG'` refusal) — plus the one code constant,
 * `SIGN_IN_REQUIRED_REASON` (`'sign-in-required'`, `lib/channel/closed-store.ts`).
 */
const CODE_CALL =
  /^(?:(?:\w+\.failureCode|signInErrorParam|orgCartFailureCode|roleFailureCode|memberFailureCode|parseRejectReason)\(|SIGN_IN_REQUIRED_REASON$)/;

/**
 * Template-built code values that are not a vocabulary call, each read and
 * confirmed to be typed as a closed code union — keyed `file:name=expression`.
 * The list stays short: a new entry is a reason to call a vocabulary instead.
 */
const CODE_IN_TEMPLATE = new Map<string, string>([
  ['app/(auth)/login/mfa/page.tsx:error=errorCode', '`signInErrorParam(err, …)`, held to compare against `CHANNEL_NOT_PERMITTED_ERROR`'],
  ['app/account/organization-security/actions.ts:error=code', "`'FORBIDDEN' | 'FAILED'`"],
  ['app/(auth)/invitations/[token]/accept/page.tsx:error=code', 'an `InvitationAcceptCode`, the closed return of `INVITATION_ACCEPT_ERRORS.failureCode` (#808)'],
  ['app/(account)/organization/carts/[id]/actions.ts:error=parsed.code', 'the refusal half of `parseRejectReason`, `\'REASON_REQUIRED\' | \'REASON_TOO_LONG\'` — read off a variable, so no call is visible'],
  ['app/(commerce)/checkout/page.tsx:couponError=reason', '`result.reason` held to `^[a-z_]{1,64}$`, else `generic`'],
  ['app/(account)/quick-order/page.tsx:problem=overflow', "`'preview_too_large' | 'preview_full'`"],
  ['components/newsletter/NewsletterSignup.tsx:status=status', "`'pending' | 'active'`"],
  ['lib/payments/post-payment-landing.ts:outcome=reason', 'a `PaymentFailureReason`'],
  ['lib/payments/post-payment-landing.ts:outcome=outcome', 'a `PaymentReturnOutcome`'],
  ['components/SocialLoginButtons.tsx:salesChannel=encodeURIComponent(salesChannelCode)', 'the channel code the backend resolves'],
]);

const files = SCANNED.flatMap((dir) => sources(join(ROOT, dir))).map((path) => relative(ROOT, path).split('\\').join('/'));
const sites = files.flatMap((file) => sitesOf(file, readFileSync(join(ROOT, file), 'utf8')));

/** A literal value is fixed text the source chose — `?built=cart`, `formsOutcome=accepted`. */
function offends(site: Site): boolean {
  if (site.literal) return false;
  const safe = SAFE[site.name];
  if (!safe) return true;
  if (safe.kind === 'code' && site.encoded) return !CODE_THROUGH_SEARCH_PARAMS.has(`${site.file}:${site.name}`);
  if (safe.kind === 'code') {
    // A template-built code needs proof, not a name (issue #810).
    if (site.value === undefined) return true;
    return !CODE_CALL.test(site.value) && !CODE_IN_TEMPLATE.has(`${site.file}:${site.name}=${site.value}`);
  }
  return false;
}

const offenders = [...new Set(sites.filter(offends).map((site) => `${site.file}:${site.name}`))].sort();

describe('no page builds free text into a URL (issue #790)', () => {
  it('finds the parameters it was written against', () => {
    // A net that matches nothing passes everything: these are built in more than one way.
    const names = new Set(sites.map((site) => site.name));
    for (const name of ['error', 'next', 'listAdded', 'q', 'couponError', 'formsReason']) expect(names).toContain(name);
  });

  it('reaches components/ and lib/, and not lib/api/', () => {
    const scanned = new Set(sites.map((site) => site.file));
    for (const file of ['components/newsletter/NewsletterSignup.tsx', 'lib/cartMinimum.ts', 'lib/payments/post-payment-landing.ts']) {
      expect(scanned).toContain(file);
    }
    expect(files.some((file) => file.startsWith('lib/api/') || file.startsWith('lib/dictionary/'))).toBe(false);
  });

  it('no quick-order build report travels in the URL', () => {
    expect(sites.filter((site) => site.name === 'notAdded' || site.name === 'rfq')).toEqual([]);
  });

  it('every parameter built from a value is on the allow-list', () => {
    expect(offenders.filter((site) => !KNOWN_FREE_TEXT.has(site))).toEqual([]);
  });

  it('the known list names only sites that still need it', () => {
    expect([...KNOWN_FREE_TEXT].filter((site) => !offenders.includes(site))).toEqual([]);
  });

  it('a code built into a template from an arbitrary string is flagged (issue #810)', () => {
    const fixture = [
      'const message = err instanceof Error ? err.message : String(err);',
      'redirect(`/login?error=${message}`);',
      'redirect(`/cart?error=${CART_ERRORS.failureCode(err, \'REMOVE_FAILED\')}`);',
      'redirect(`/login?error=${signInErrorParam(err, \'LOGIN_FAILED\')}`);',
      'redirect(`/orders/1?error=${opened ? \'A\' : \'B\'}`);',
    ].join('\n');
    const flagged = sitesOf('fixture.ts', fixture).filter(offends);
    expect(flagged.map((site) => site.name)).toEqual(['error']);
    expect(flagged[0]!.value).toBe('message');
  });

  it('the proven-code list names only sites that still need it', () => {
    const used = new Set(sites.map((site) => `${site.file}:${site.name}=${site.value ?? ''}`));
    expect([...CODE_IN_TEMPLATE.keys()].filter((key) => !used.has(key))).toEqual([]);
  });

  it('the typed values a URL-borne error carries have one reader (issue #791)', () => {
    // A page that validates a figure with its own pattern drifts from the rest; every one reads
    // through `lib/url-typed-values.ts`, so the pattern appears nowhere else in what this net scans.
    const PATTERNS = [/\[1-9\]\\d\{0,8\}/, /\[A-Z\]\{3\}/];
    const own = files.filter(
      (file) => file !== 'lib/url-typed-values.ts' && PATTERNS.some((p) => p.test(readFileSync(join(ROOT, file), 'utf8'))),
    );
    expect(own).toEqual([]);
  });

  it('finds the figures of a URL-borne error (issue #791)', () => {
    const names = new Set(sites.map((site) => site.name));
    for (const name of ['min', 'available', 'total', 'currency', 'minValue', 'subtotal', 'couponShortfall', 'couponShortfallCurrency']) {
      expect(names).toContain(name);
    }
  });

  it('the quick-order preview is not a URL parameter', () => {
    expect(sites.filter((site) => site.name === 'preview')).toEqual([]);
  });
});
