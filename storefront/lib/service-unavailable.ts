/**
 * The three names the reachability gate and the page it serves have to agree
 * on, and the one sanitiser between them.
 *
 * They live in their own module because the two sides run in different
 * runtimes — `middleware.ts` in the edge sandbox, `app/layout.tsx` and
 * `app/service-unavailable/page.tsx` in the Node server render — and a header
 * name spelled twice is a page that renders full chrome around an outage
 * notice, with nothing to say so.
 */

/** Where the gate rewrites to. Also a real, directly addressable route. */
export const SERVICE_UNAVAILABLE_PATH = '/service-unavailable';

/**
 * The request header the gate stamps so the root layout knows every backend
 * read below it would fail.
 */
export const UNAVAILABLE_HEADER = 'x-backend-unreachable';

/** The request header carrying the address the buyer actually asked for. */
export const UNAVAILABLE_RETRY_HEADER = 'x-backend-unreachable-retry';

/**
 * What the `Retry-After` header says, in seconds, and what the page's copy is
 * written against.
 *
 * One number, so the header and the sentence a buyer reads cannot drift apart.
 * A minute is the conventional order of magnitude for a restarting service and
 * is short enough that a buyer who waits it out is not abandoned.
 */
export const RETRY_AFTER_SECONDS = 60;

/**
 * The retry target, reduced to something that can only ever be a path on this
 * origin.
 *
 * The value comes from the request line, so it is attacker-chosen. It is
 * rendered into an `href`, where a scheme-relative `//host` would leave the
 * shop and a scheme like `javascript:` would be worse — React escapes the text
 * and does not judge the scheme. Anything that is not a single-slash-rooted
 * path becomes the home page, which is a correct retry for every request whose
 * own address could not be trusted.
 */
/**
 * What the gate does with a request before it costs anything.
 *
 * - `unavailable` — answer the notice at `503` without asking anything.
 * - `pass` — hand the request straight to the render.
 * - `ask` — consult the backend's reachability and then do one of the two.
 */
export type GateDecision = 'pass' | 'ask' | 'unavailable';

/**
 * The gate's decision, as a pure function of the request.
 *
 * Two special cases, and each one is a decision rather than an optimisation.
 *
 * The notice's **own address** answers `503` to whoever asks for it, backend up
 * or down. That address is how an operator or a designer looks at the page
 * without taking the backend down, and answering it `200` would be a document
 * saying the shop is unavailable above a status line saying everything is well —
 * the `200`-carrying-bad-news shape this feature exists to remove. It was
 * measured answering `200` before this returned `unavailable` for it.
 *
 * A **prefetch** passes because it is speculative and the router caches its
 * answer: an outage notice put there would be served from the client's cache
 * after the outage was over, on a navigation nobody could retry.
 */
export function gateDecision(request: {
  readonly pathname: string;
  readonly prefetch: boolean;
}): GateDecision {
  if (request.pathname === SERVICE_UNAVAILABLE_PATH) return 'unavailable';
  return request.prefetch ? 'pass' : 'ask';
}

export function safeRetryTarget(candidate: string | null | undefined): string {
  if (typeof candidate !== 'string') return '/';
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  // A backslash is a path separator to some browsers' URL parsers but not to
  // Next's, so `/\evil.example` is a same-origin path here and an origin change
  // there. Refused rather than reasoned about.
  if (candidate.includes('\\')) return '/';
  return candidate;
}
