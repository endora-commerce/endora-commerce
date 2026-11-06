import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Issue #790 — a URL carries a code and validated typed values, never free text
 * (`specs/conventions/module-i18n.md`). `no-sentence-in-url.test.ts` watches the
 * three message parameters by name; this net watches every query parameter a
 * page or route **builds** from a value — a `?name=${…}` template, an
 * `encodeURIComponent`, a `new URLSearchParams({ … })` key, a `.set('name', …)`
 * on a `URLSearchParams` or a `URL`'s `searchParams` — and refuses any name not
 * on the allow-list below. `?listAdded=` (a shopping list's name) and
 * `?preview=` (the quick-order CSV) are the two this net was written against.
 *
 * A name on the allow-list is a promise about its value, not a proof: the
 * per-page tests in this directory are the evidence that a crafted value never
 * reaches the screen. A new parameter must justify itself here.
 */

const APP = resolve(import.meta.dirname, '../../app');

type Kind = 'code' | 'id' | 'number' | 'path' | 'query';

/**
 * The parameters known to be safe, and why. `code` values are fixed ASCII
 * tokens a page words from its own vocabulary and drops when it does not know
 * them (`lib/url-errors.ts`); `id` values are looked up, or shown only after a
 * shape check; `number` values are parsed as numbers; `path` is an in-site
 * return path the login flow validates; `query` is the text the buyer typed
 * into a search box themselves.
 */
const SAFE: Record<string, { kind: Kind; why: string }> = {
  // Codes — the page words them; an unknown one shows nothing or the generic failure.
  error: { kind: 'code', why: 'a page vocabulary code (issue #745)' },
  reason: { kind: 'code', why: 'a contact/newsletter outcome code' },
  problem: { kind: 'code', why: 'a quick-order vocabulary code' },
  couponError: { kind: 'code', why: 'a coupon refusal code' },
  formsReason: { kind: 'code', why: 'a form-submission outcome code' },
  newsletter: { kind: 'code', why: 'a newsletter sign-up outcome code' },
  // Ids and tokens — looked up server-side, or never printed.
  id: { kind: 'id', why: 'an order id the page looks up' },
  orderId: { kind: 'id', why: 'an order id the page looks up' },
  rfqId: { kind: 'id', why: 'a quote-request id the page looks up' },
  rfq: { kind: 'id', why: 'a quote-request reference, shown only when it is reference-shaped' },
  listAdded: { kind: 'id', why: 'a shopping-list id; the page reads the name of the buyer’s own list (issue #790)' },
  qtyError: { kind: 'id', why: 'the shopping-list line id the refusal sits beside' },
  token: { kind: 'id', why: 'an opaque verification or reset token, never printed' },
  form: { kind: 'id', why: 'a contact-form block id' },
  formsBlock: { kind: 'id', why: 'a form block id' },
  formsAttempt: { kind: 'id', why: 'a form-submission attempt id' },
  cartSkips: { kind: 'id', why: 'item/product ids, reason codes and minimums, each re-validated on read (`lib/batchReport.ts`)' },
  // Numbers.
  page: { kind: 'number', why: 'a page number' },
  sent: { kind: 'number', why: 'a line count' },
  cartAdded: { kind: 'number', why: 'a line count' },
  cartSkipped: { kind: 'number', why: 'a line count' },
  rfqAdded: { kind: 'number', why: 'a line count' },
  rfqSkipped: { kind: 'number', why: 'a line count' },
  members: { kind: 'number', why: 'a member count' },
  invitations: { kind: 'number', why: 'an invitation count' },
  couponShortfall: { kind: 'number', why: 'an amount, formatted by the page' },
  couponShortfallCurrency: { kind: 'code', why: 'an ISO 4217 currency code' },
  // A path and a query.
  next: { kind: 'path', why: 'an in-site return path; the login flow refuses anything else' },
  q: { kind: 'query', why: 'the search text the buyer typed themselves' },
};

/**
 * Sites that still put free text into a URL — the list only shrinks. Each is a
 * `file:parameter` pair this net found and the fix for issue #790 did not
 * cover; see the pull request for the follow-up.
 */
const KNOWN_FREE_TEXT = new Set<string>([
  // An API `detail` sentence through `new URLSearchParams({ error })`, rendered as given.
  '(auth)/invitations/[token]/accept/page.tsx:error',
  // The build's `rejected[]`, carrying each product's name, rendered from the URL.
  '(account)/quick-order/page.tsx:notAdded',
]);

interface Site {
  file: string;
  name: string;
  /** Built through `URLSearchParams` — the value is encoded, so a code is indistinguishable from a sentence. */
  encoded: boolean;
  /** The value is a string literal, so it is fixed text the source chose. */
  literal: boolean;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const LITERAL = /^\s*(?:'[^']*'|"[^"]*"|`[^`$]*`)\s*$/;

function sitesOf(file: string, source: string): Site[] {
  const sites: Site[] = [];
  for (const m of source.matchAll(/[?&]([A-Za-z_]\w*)=(?:\$\{|'\s*\+)/g)) {
    sites.push({ file, name: m[1]!, encoded: false, literal: false });
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
  '(commerce)/cart/page.tsx:couponError', // `result.reason`, the coupon refusal code
  'forms/contact/route.ts:reason', // `outcome.error`, a contact outcome code
  '(commerce)/cart/page.tsx:couponShortfallCurrency', // the API's ISO 4217 code, which `Intl` refuses unless it is one
  'newsletter/subscribe/route.ts:reason', // `outcome.error`, a newsletter outcome code
  'newsletter/subscribe/route.ts:newsletter', // `outcome.status`, a newsletter outcome code
  'forms/submit/route.ts:formsReason', // `outcome.reason`, a submission outcome code
]);

const files = sources(APP).map((path) => relative(APP, path).split('\\').join('/'));
const sites = files.flatMap((file) => sitesOf(file, readFileSync(join(APP, file), 'utf8')));

/** A literal value is fixed text the source chose — `?built=cart`, `formsOutcome=accepted`. */
function offends(site: Site): boolean {
  if (site.literal) return false;
  const safe = SAFE[site.name];
  if (!safe) return true;
  if (safe.kind === 'code' && site.encoded) return !CODE_THROUGH_SEARCH_PARAMS.has(`${site.file}:${site.name}`);
  return false;
}

const offenders = [...new Set(sites.filter(offends).map((site) => `${site.file}:${site.name}`))].sort();

describe('no page builds free text into a URL (issue #790)', () => {
  it('finds the parameters it was written against', () => {
    // A net that matches nothing passes everything: these are built in more than one way.
    const names = new Set(sites.map((site) => site.name));
    for (const name of ['error', 'next', 'listAdded', 'q', 'couponError', 'formsReason']) expect(names).toContain(name);
  });

  it('every parameter built from a value is on the allow-list', () => {
    expect(offenders.filter((site) => !KNOWN_FREE_TEXT.has(site))).toEqual([]);
  });

  it('the known list names only sites that still need it', () => {
    expect([...KNOWN_FREE_TEXT].filter((site) => !offenders.includes(site))).toEqual([]);
  });

  it('the quick-order preview is not a URL parameter', () => {
    expect(sites.filter((site) => site.name === 'preview')).toEqual([]);
  });
});
