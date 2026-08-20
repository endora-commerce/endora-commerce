import type { FastifyRequest } from 'fastify';
import { LANGUAGE_FALLBACK, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@b2b/contracts';
import { currentSalesChannel } from '../sales-channels/sales-channel-resolver.middleware.js';

/**
 * Which language the platform answers a request in (feature 083, D-130 … D-139).
 *
 * **The platform answers in the language the client is rendering in, and each
 * audience states that language the way its own client already computes it.**
 * The two shipped clients compute it differently, so this is one function with
 * one branch on actor kind rather than one ladder pretending to serve both:
 *
 * ```
 * actor.kind === 'admin'
 *   1. the stored `preferredLanguage`      — the admin SPA renders from this
 *   2. LANGUAGE_FALLBACK                      field and ignores the browser
 *
 * otherwise (anonymous | customer | api_key)
 *   0. [reserved] a stored per-customer preference — see below
 *   1. Accept-Language, q-sorted, first tag that normalises
 *   2. the resolved sales channel's `defaultLanguage`
 *   3. LANGUAGE_FALLBACK
 * ```
 *
 * **The channel is the buyer's backstop, never their override** (D-131). The
 * platform already resolves product *content* header-first
 * (`CatalogQueryService.pickLang`, feature 022); inverting it here would name a
 * product in one language and refuse it in another inside one response body.
 * And the header is not a browser setting on this platform — it is the
 * storefront's own answer, written by its language switcher, so overriding it
 * from the channel would contradict a choice the buyer made two clicks ago.
 *
 * Before this file, `resolvePreferredLanguage` was a closure in each of the two
 * composition roots and both began `if (actor.kind !== 'admin') return null`.
 * Every Polish error sentence the platform ships was therefore unreachable for
 * a buyer, from the day the hook was written (issue #234). The policy lives in
 * one kernel file now: the roots keep one line each, the admin lookup, which is
 * the only rung that reads a module's table.
 */

/** Bound on the header read — the parse half of the security bound (D-139 § 8.1). */
const MAX_HEADER_LENGTH = 512;
/** Bound on how many tags are considered, applied **after** q-sorting. */
const MAX_TAGS = 10;

export interface RequestLanguageDeps {
  /**
   * The admin's stored `preferredLanguage`, or `null`.
   *
   * Supplied by the composition root rather than resolved as a port,
   * deliberately (D-137). This runs inside error serialisation, so a gated port
   * would throw `ModuleDisabledError` while another error is being serialised,
   * and the guard that mistake needs is a `catch` around a port —
   * `check:port-catches` refuses one, and is right to. A root reading its own
   * entity has no gate and no such failure mode.
   */
  adminPreferredLanguage: (adminUserId: string) => Promise<string | null>;
}

/**
 * The slice of the ambient actor this resolver reads.
 *
 * Structural, like the sales-channel middleware's own actor slice: the kernel
 * may not import `src/modules/` (D-52), and `request.actor` is typed
 * non-optional by the auth plugin's module augmentation — but a response
 * serialised before that hook ran carries none, so the property is read as
 * optional here. The resolver runs while an error is being rendered; throwing
 * would mean failing to render an error with another error.
 */
interface ActorSlice {
  kind?: string;
  adminUserId?: string;
}

/**
 * A tag reduced to a language the platform ships a bundle for, or `null`.
 *
 * The candidate set is `SUPPORTED_LANGUAGES` and nothing else — **not** the
 * channel's `languages[]` (D-135). That column is a market's content offer, is
 * empty on most rows that exist, and bounding by it would need an "empty means
 * unbounded" carve-out: an absent value silently becoming a permissive one.
 *
 * A tag that does not normalise is not an error and is not echoed anywhere. It
 * falls to the next rung; it never becomes one.
 */
export function normalise(tag: string | null | undefined): SupportedLanguage | null {
  if (!tag) return null;
  const primary = tag.split('-', 1)[0]?.trim().toLowerCase() ?? '';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary)
    ? (primary as SupportedLanguage)
    : null;
}

/**
 * `Accept-Language` as an ordered list of tags, heaviest `q` first.
 *
 * RFC 9110 makes the header a q-weighted list, and three sites in the tree read
 * it as `split(',')[0]` — so `en;q=0.2,pl;q=0.9` is read as English by every
 * one of them. Exported for their conversion (T024); nothing else in this
 * feature reads it.
 *
 * Bounded twice, because the header is attacker-controlled on every request:
 * to {@link MAX_HEADER_LENGTH} characters and, after weighting, to
 * {@link MAX_TAGS} tags. Exceeding either is not an error — the remainder is
 * simply not read. A malformed `q` drops its tag rather than guessing a weight.
 * `*` is returned as an ordinary tag and never normalises.
 */
export function parseAcceptLanguage(header: string | string[] | undefined): string[] {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return [];
  const weighted: Array<{ tag: string; weight: number; order: number }> = [];
  for (const part of raw.slice(0, MAX_HEADER_LENGTH).split(',')) {
    const [tagPart, ...parameters] = part.split(';');
    const tag = tagPart?.trim() ?? '';
    if (tag.length === 0) continue;
    const weight = readWeight(parameters);
    if (weight === null) continue;
    weighted.push({ tag, weight, order: weighted.length });
  }
  weighted.sort((a, b) => b.weight - a.weight || a.order - b.order);
  return weighted.slice(0, MAX_TAGS).map((entry) => entry.tag);
}

/** The `q` parameter of one list element: its weight, `1` by default, or `null` if malformed. */
function readWeight(parameters: string[]): number | null {
  for (const parameter of parameters) {
    const separator = parameter.indexOf('=');
    if (separator < 0) continue;
    if (parameter.slice(0, separator).trim().toLowerCase() !== 'q') continue;
    const value = parameter.slice(separator + 1).trim();
    const parsed = Number(value);
    if (value.length === 0 || !Number.isFinite(parsed)) return null;
    return parsed;
  }
  return 1;
}

/**
 * The ladder in this file's header, as a function of the request.
 *
 * It never throws: every rung that cannot answer falls to the next, and the
 * last always answers. The buyer arm performs no database read at all — the
 * channel is already resolved and cached on the request scope.
 */
export function createRequestLanguageResolver(
  deps: RequestLanguageDeps,
): (request: FastifyRequest) => Promise<SupportedLanguage> {
  return async (request: FastifyRequest): Promise<SupportedLanguage> => {
    const actor = (request as { actor?: ActorSlice }).actor;

    // The admin arm reads the stored preference and nothing else (D-132).
    // `admin/src/App.tsx` renders the chrome from `preferredLanguage ?? 'en'`
    // and does not send `Accept-Language` at all, so consulting the browser
    // here would put Polish refusals on an English screen. Consulting the
    // channel would make an operator's error language depend on whichever
    // channel their last request happened to resolve, which is not a thing
    // any operator chose.
    if (actor?.kind === 'admin' && typeof actor.adminUserId === 'string') {
      return normalise(await deps.adminPreferredLanguage(actor.adminUserId)) ?? LANGUAGE_FALLBACK;
    }

    // Rung 0 — a stored per-customer preference goes here when one exists, and
    // the storefront's language switcher must write it for a logged-in buyer
    // (D-133). Deliberately a comment and not a branch: there is no column, no
    // contract field and no screen, and #234 does not need one.

    for (const tag of parseAcceptLanguage(request.headers['accept-language'])) {
      const language = normalise(tag);
      if (language) return language;
    }

    // A `null` channel is **normal**, not a failure: the resolver middleware
    // does not run on `/api/v1/_health` or off the API prefix, and a request
    // with no scope open has none either. The rung falls through; nothing is
    // logged and nothing throws. Do not add a throw here — `currentSalesChannel`
    // has a throwing sibling (`getResolvedChannel`) and reaching for it would
    // turn every health-path error into a 500.
    return normalise(currentSalesChannel()?.defaultLanguage) ?? LANGUAGE_FALLBACK;
  };
}
