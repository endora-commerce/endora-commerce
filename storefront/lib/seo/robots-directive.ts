/**
 * A channel's default robots policy → what a response carries
 * (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §6).
 *
 * The pure half of what `middleware.ts` and `app/layout.tsx` do with the
 * policy, kept here so that it can be tested without a booted storefront — the
 * arrangement `lib/service-unavailable.ts` already has with the reachability
 * gate.
 *
 * ## The default only ever adds
 *
 * Every function here emits `noindex`, `nofollow`, both, or nothing. There is
 * no input that produces `index` or `follow`, so the default cannot loosen what
 * a page declares for itself: the page's own `<meta name="robots">` is never
 * read, replaced or suppressed, and a search engine reading several robots
 * directives for one address applies the most restrictive of them. For the
 * policy every untouched instance has — index and follow — nothing is emitted
 * at all, which is what keeps such an instance's responses identical to what
 * they were before this existed.
 */

import type { RobotsPolicyRead } from './crawler-policy';

/** The three directives a default can add. */
export type RobotsDirective = 'noindex' | 'nofollow' | 'noindex, nofollow';

const DIRECTIVES: ReadonlySet<string> = new Set<RobotsDirective>([
  'noindex',
  'nofollow',
  'noindex, nofollow',
]);

/** The response header every covered path carries when the policy restricts something. */
export const ROBOTS_RESPONSE_HEADER = 'X-Robots-Tag';

/**
 * The request header the middleware hands the directive to the render in.
 *
 * Trusted by the root layout **only because the middleware writes or deletes it
 * on every request it handles** — see {@link forwardRobotsDefault}.
 */
export const ROBOTS_DEFAULT_REQUEST_HEADER = 'x-robots-default';

/**
 * The directive a read of the policy asks for, or `null` for none.
 *
 * "No policy" and "the policy could not be read and none was ever known" are
 * the same here on purpose (FR-017): a page is never failed, and never
 * restricted, on the strength of a question that went unanswered.
 */
export function robotsDirective(read: RobotsPolicyRead): RobotsDirective | null {
  if (read.kind !== 'value') return null;
  const { index, follow } = read.value;
  if (!index && !follow) return 'noindex, nofollow';
  if (!index) return 'noindex';
  if (!follow) return 'nofollow';
  return null;
}

/**
 * Put the directive on a response. Sets nothing, and removes nothing, when
 * there is none.
 *
 * `set`, not `append`: the header states this channel's default once. A second
 * value beside it would be read as a second directive.
 */
export function stampRobotsResponse(headers: Headers, directive: RobotsDirective | null): void {
  if (directive !== null) headers.set(ROBOTS_RESPONSE_HEADER, directive);
}

/**
 * Hand the directive to the render — or make sure nothing is handed to it.
 *
 * The delete is the half that matters. The header arrives from the network like
 * any other, so a request can carry one; overwriting or deleting it on every
 * request is what stops a client from choosing what the layout renders.
 */
export function forwardRobotsDefault(headers: Headers, directive: RobotsDirective | null): void {
  if (directive === null) headers.delete(ROBOTS_DEFAULT_REQUEST_HEADER);
  else headers.set(ROBOTS_DEFAULT_REQUEST_HEADER, directive);
}

/**
 * What the root layout renders from the request header: one of the three
 * directives, or `null`.
 *
 * The middleware already guarantees the header's origin. This guarantees its
 * content independently, so the layout can only ever render one of three known
 * strings whatever reaches it.
 */
export function robotsDirectiveFromHeader(value: string | null | undefined): RobotsDirective | null {
  return typeof value === 'string' && DIRECTIVES.has(value) ? (value as RobotsDirective) : null;
}

/**
 * The paths that were this middleware's whole population before the default
 * robots policy widened its matcher — written as that matcher was, so that
 * "document" keeps meaning exactly what it meant.
 *
 * A document gets the reachability gate, `x-pathname` and the `503` rewrite.
 * Everything else the middleware now sees — public files, `/robots.txt`,
 * `/llms.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/_next/image` — is there for the
 * response header alone and must not be gated: an image is not a page, and
 * rewriting one to the outage notice would answer a `<img>` with HTML.
 */
const DOCUMENT_PATH =
  /^\/((?!_next\/static|_next\/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|.*\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|woff|woff2|ttf|eot)$).*)$/;

/**
 * The files this storefront has come to serve since, at addresses that
 * matcher took for documents because nothing was there. Exact addresses, kept
 * apart from the pattern so that the pattern stays the matcher it was.
 *
 * `/llms.txt` (`app/llms.txt/route.ts`) is handled as `/robots.txt` is. Gated
 * as a document, a process holding the channel's last-known `llms.txt` would
 * answer the outage notice — a web page — instead of serving it while the
 * backend is down.
 */
const FILES_SINCE: ReadonlySet<string> = new Set(['/llms.txt']);

/**
 * The route handlers that are not pages and must not be treated as one, at
 * exact addresses. Issue #1279: the two ends of a federated customer sign-in
 * (`app/auth/federated/start/route.ts`, `app/auth/federated/complete/route.ts`)
 * answer a redirect, never a page. As documents they would be prefixed with a
 * language, and on a store closed to anonymous visitors the returning buyer —
 * who has no session until `complete` sets it — would be sent to the sign-in
 * page instead of being signed in. Both stay channel-stamped like any file.
 */
const HANDLERS_SINCE: ReadonlySet<string> = new Set(['/auth/federated/start', '/auth/federated/complete']);

/** Whether `pathname` is a document rather than a file. See {@link DOCUMENT_PATH}. */
export function isDocumentPath(pathname: string): boolean {
  return !FILES_SINCE.has(pathname) && !HANDLERS_SINCE.has(pathname) && DOCUMENT_PATH.test(pathname);
}
