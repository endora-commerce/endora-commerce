import type { FastifyRequest } from 'fastify';
import {
  LANGUAGE_FALLBACK,
  SUPPORTED_LANGUAGES,
  type Actor,
  type SupportedLanguage,
} from '@endora-commerce/contracts';
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
   * Supplied by the composition root rather than resolved here (D-137): the
   * policy is the kernel's, the one rung that reads a module's data is not.
   *
   * **What the root supplies it out of is a gated port, and this doc block used
   * to say it must not be.** The paragraph read: "a gated port would throw
   * `ModuleDisabledError` while another error is being serialised, and the
   * guard that mistake needs is a `catch` around a port — `check:port-catches`
   * refuses one, and is right to. A root reading its own entity has no gate and
   * no such failure mode." Feature 080's T052 then converted the closure from
   * `em().findOne(AdminUser, …)` to `adminUserReadPort.findById(…)`, because
   * D-168 leaves a packaged module no named entity class for a root to read —
   * so the entity-reading alternative the paragraph rested on no longer exists.
   *
   * The prediction was exactly right about the consequence. With `admin_users`
   * platform-absent, every error answered to a signed-in admin lost its
   * `ErrorEnvelope` outright: the throw lands in `preSerialization` of a reply
   * Fastify is already treating as an error, so it cannot be routed back
   * through `setErrorHandler` and Fastify's own fallback serialiser answers
   * instead. The remedy is not the `catch` the paragraph refused — the guard
   * lives in `registerErrorEnvelope`, around the whole decoration, where it is
   * a renderer declining to let a decoration replace the thing it decorates
   * rather than a caller hiding a capability's absence.
   *
   * So the standing rule for this dependency is the weaker, true one: it may
   * throw, and a caller that cannot afford the throw must say so at its own
   * seam. {@link createRequestLanguageResolver} does not catch it.
   */
  adminPreferredLanguage: (adminUserId: string) => Promise<string | null>;
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
 * Every rung that cannot *answer* falls to the next, and the last always
 * answers. The buyer arm performs no database read at all — the channel is
 * already resolved and cached on the request scope.
 *
 * The admin arm is the exception and this used to claim otherwise ("it never
 * throws"): it calls {@link RequestLanguageDeps.adminPreferredLanguage}, which
 * a root supplies out of a gated port, so it throws while the owner of that
 * port is absent. Not caught here, deliberately — a `catch` around a port at
 * the one site that reads it is the shape `check:port-catches` refuses. The
 * caller that cannot afford the throw guards at its own seam, and there is one:
 * `registerErrorEnvelope`, whose decoration falls back to the untranslated
 * envelope.
 */
export function createRequestLanguageResolver(
  deps: RequestLanguageDeps,
): (request: FastifyRequest) => Promise<SupportedLanguage> {
  return async (request: FastifyRequest): Promise<SupportedLanguage> => {
    // `Actor | undefined` rather than `Actor`, and the widening is this site's
    // rather than the declaration's (T118b). `request.actor` is decorated by
    // `auth`'s `onRequest` hook, and this resolver runs while an error is being
    // **serialised** — a reply Fastify rejected before that hook ran carries no
    // decoration at all. Throwing here would mean failing to render an error
    // with another error, so the absent case falls through to the rungs below.
    //
    // Until T118b this read went through a private `ActorSlice` interface,
    // declared here because D-52 forbids the kernel an import of `auth`. The
    // shape is `@endora-commerce/contracts`' now and the augmentation is the
    // platform's own, so the restatement is gone and this reads the type every
    // other consumer reads.
    const actor = request.actor as Actor | undefined;

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
