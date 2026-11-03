import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backendReachability } from './lib/api/backend-reachability';
import {
  RETRY_AFTER_SECONDS,
  SERVICE_UNAVAILABLE_PATH,
  UNAVAILABLE_HEADER,
  UNAVAILABLE_RETRY_HEADER,
  gateDecision,
  safeRetryTarget,
} from './lib/service-unavailable';
import { readRobotsPolicy } from './lib/seo/crawler-policy';
import { readChannelIdentity, type ChannelIdentity } from './lib/channel/channel-identity';
import { blogRouteDecision, readBlogRouting } from './lib/blog/blog-routing';
import { SALES_CHANNEL_REQUEST_HEADER } from './lib/channel/channel-header';
import { closedStoreRedirect } from './lib/channel/closed-store';
import {
  LANGUAGE_PREFIX_REQUEST_HEADER,
  LANGUAGE_REQUEST_HEADER,
  isLanguageNeutral,
  localizePath,
  parseLocalePath,
  stripLocalePrefix,
  type LocaleParse,
  type UrlLanguageState,
} from './lib/i18n/locale-path';
import {
  forwardRobotsDefault,
  isDocumentPath,
  robotsDirective,
  stampRobotsResponse,
  type RobotsDirective,
} from './lib/seo/robots-directive';

/**
 * Forwards the incoming request's pathname as `x-pathname` so server
 * components (which don't otherwise receive the pathname) can branch on it.
 * Used by the root layout to render the **minimal checkout chrome**
 * (logo-only header, no Megamenu / Footer) on `/checkout*` routes per
 * feature 036 US5.
 *
 * ## It is the one seam that puts a channel's default robots on a response
 *
 * An operator chooses, per sales channel, what search engines are told about
 * the whole storefront (`specs/144-seo-search-engine-robots/`). That choice
 * reaches a response here and nowhere else: as an `X-Robots-Tag` header on
 * everything this function sees, and as a request header from which the root
 * layout renders one extra `<meta name="robots">`. No route file takes part,
 * which is what keeps a route's own declaration the route's own.
 *
 * So the matcher covers everything except `/_next/static` — the files a search
 * engine can index include the sitemap, the optimised images and what is under
 * `public/`, and no other seam can add a per-channel header to those. The
 * function **branches first**: a path that is not a document gets the header
 * and nothing else — no reachability probe, no `x-pathname`, no rewrite — and
 * is otherwise served exactly as before. `isDocumentPath` is the matcher this
 * file had before it was widened, so "document" means what it always meant.
 *
 * The policy is read through a per-process cache (`lib/seo/crawler-policy.ts`)
 * that never rejects: a backend that cannot be asked costs a page nothing.
 *
 * ## It is also the storefront's status line for an unreachable backend
 *
 * A Next 15 App Router page render cannot answer `503` — measured, with the
 * evidence in `lib/api/backend-reachability.ts`' doc block — and middleware is
 * the one seam in front of the render that can. So the reachability gate lives
 * here, and it covers **every route the matcher covers**, which is every
 * document this storefront serves: a shop whose API is down is down on `/p/…`
 * and `/cart` exactly as it is on `/`, and the defect was only ever *measured*
 * on `/`.
 *
 * A rewrite rather than a redirect, deliberately. The buyer's URL is not wrong
 * and has not moved; it is momentarily unserveable, which is what `503` says.
 * A redirect would put `/service-unavailable` in the address bar, lose the page
 * they asked for, and — per
 * `specs/108-storefront-response-status/contracts/response-status.md` §3.1 —
 * claim a move that did not happen. `NextResponse.rewrite(target, { status })`
 * was measured to answer that status carrying the fully server-rendered
 * document at `target`, which is what makes this possible at all.
 *
 * **This gate never inspects an error the application raised.** It asks a
 * question only the transport can answer, so an application defect keeps
 * throwing and keeps answering `500` — see the discrimination section of
 * `backend-reachability.ts`.
 *
 * ## It names the sales channel, and keeps anonymous visitors off closed stores
 *
 * Every backend call names the channel it is made on
 * (`specs/154-sales-channel-access/contracts/storefront-ux.md` §1, owner
 * decision D1), because the backend decides who may use a store from that
 * name. A proxy may stamp `x-sales-channel` per host; when none did, this
 * function stamps the code of the channel the backend resolves for this
 * storefront, read through a per-process cache (`lib/channel/channel-identity.ts`)
 * on the crawler policy's terms. From here on the render, route handlers and
 * server actions all read one code, and the transport sends it on every call.
 *
 * The same read says whether the store is open to anonymous visitors. A document
 * requested without a session on a store that is not is redirected to the
 * sign-in page (§2) — rather than rendered from reads the backend refuses one by
 * one into an empty shop. Files are never redirected; the outage gate runs
 * first, so a backend that cannot be reached is still answered `503`.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const channelCode = request.headers.get(SALES_CHANNEL_REQUEST_HEADER) || undefined;
  const requestHeaders = new Headers(request.headers);

  if (!isDocumentPath(pathname)) {
    // A file, not a page. The directive, the channel, and the same care with
    // the request header as below — a missing file is answered by the not-found
    // page, which the root layout renders — and nothing else.
    const [policy, identity] = await Promise.all([
      readRobotsPolicy(channelCode),
      identityOf(channelCode),
    ]);
    const directive = robotsDirective(policy);
    forwardRobotsDefault(requestHeaders, directive);
    stampChannel(requestHeaders, channelCode, identity);
    // Feature 167 — files carry no language; a client's value is never forwarded.
    requestHeaders.delete(LANGUAGE_REQUEST_HEADER);
    requestHeaders.delete(LANGUAGE_PREFIX_REQUEST_HEADER);
    return withRobots(NextResponse.next({ request: { headers: requestHeaders } }), directive);
  }

  // Feature 167 — never trust a language header a client sent (FR-018).
  requestHeaders.delete(LANGUAGE_REQUEST_HEADER);
  requestHeaders.delete(LANGUAGE_PREFIX_REQUEST_HEADER);
  requestHeaders.set('x-pathname', pathname);

  const decision = gateDecision({
    pathname,
    prefetch: request.headers.get('next-router-prefetch') !== null,
  });
  // Asked together: none waits for another, so a document costs one round of
  // latency however many questions the middleware has for the backend.
  const [policy, reachability, identity, blogRouting] = await Promise.all([
    readRobotsPolicy(channelCode),
    decision === 'ask' ? backendReachability() : Promise.resolve(null),
    identityOf(channelCode),
    readBlogRouting(channelCode),
  ]);
  const directive = robotsDirective(policy);
  // Written or deleted on every request, so the layout never reads a value a
  // client supplied.
  forwardRobotsDefault(requestHeaders, directive);
  stampChannel(requestHeaders, channelCode, identity);

  const urlLanguages = identity?.urlLanguages ?? [];
  const languageAware = urlLanguages.length > 0 && !isLanguageNeutral(pathname);
  const parsed: LocaleParse | null = languageAware
    ? parseLocalePath({
        pathname,
        search: request.nextUrl.search,
        acceptLanguage: request.headers.get('accept-language'),
        langCookie: request.cookies.get(LANG_COOKIE)?.value ?? null,
        languages: urlLanguages,
        aliases: identity?.urlLanguageAliases ?? [],
      })
    : null;

  if (decision === 'unavailable' || reachability === 'unreachable') {
    // The outage notice is answered at the requested URL — never after a language
    // redirect (FR-017) — in the path's language when the prefix parses.
    if (parsed?.kind === 'render') requestHeaders.set(LANGUAGE_REQUEST_HEADER, parsed.languageCode);
    // The outage notice is a document of this channel like any other: it
    // carries the directive whenever one is known.
    return withRobots(unavailable(request, requestHeaders), directive);
  }

  if (parsed === null) {
    // No URL languages known, or a language-neutral path: as before this feature.
    const signIn = closedStoreRedirect({
      pathname,
      search: request.nextUrl.search,
      hasSession: Boolean(request.cookies.get(SESSION_COOKIE)?.value),
      anonymousAccess: identity?.anonymousAccess ?? null,
    });
    if (signIn !== null) {
      return withRobots(NextResponse.redirect(new URL(signIn, request.url), 307), directive);
    }
    return withRobots(NextResponse.next({ request: { headers: requestHeaders } }), directive);
  }

  // Where the visitor is going, in language terms: the redirect's target, or this
  // URL when it renders. The closed-store check runs on its logical path, so a
  // closed store answers the prefixed sign-in page in one hop.
  const state = (current: string): UrlLanguageState => ({
    languages: urlLanguages,
    aliases: identity?.urlLanguageAliases ?? [],
    current,
  });
  const target =
    parsed.kind === 'render'
      ? {
          language: parsed.languageCode,
          logicalPath: parsed.logicalPath,
          search: request.nextUrl.search,
          browserUrl: `${pathname}${request.nextUrl.search}`,
        }
      : targetOf(parsed.location, urlLanguages, identity?.urlLanguageAliases ?? []);
  if (target !== null) {
    const signIn = closedStoreRedirect({
      pathname: target.logicalPath,
      search: target.search,
      next: target.browserUrl,
      hasSession: Boolean(request.cookies.get(SESSION_COOKIE)?.value),
      anonymousAccess: identity?.anonymousAccess ?? null,
    });
    if (signIn !== null) {
      const localized = localizePath(signIn, state(target.language));
      return withRobots(noStore(NextResponse.redirect(new URL(localized, request.url), 307)), directive);
    }
  }

  if (parsed.kind === 'redirect') {
    return withRobots(languageRedirect(request, parsed), directive);
  }

  requestHeaders.set(LANGUAGE_REQUEST_HEADER, parsed.languageCode);
  requestHeaders.set(LANGUAGE_PREFIX_REQUEST_HEADER, parsed.prefix);
  requestHeaders.set('x-pathname', parsed.logicalPath);

  // Feature 171 — the operator's blog prefix of this language, mapped onto the
  // fixed `app/blog` route; `/blog` and a former prefix move to the current one.
  const blog = blogRouteDecision(parsed.logicalPath, blogRouting, parsed.languageCode);
  if (blog?.kind === 'redirect') {
    const location = localizePath(`${blog.path}${request.nextUrl.search}`, state(parsed.languageCode));
    const response = NextResponse.redirect(new URL(location, request.url), 301);
    // A property of the channel's settings, which an operator can change: bounded, as a 308 is.
    response.headers.set('Cache-Control', 'public, max-age=3600');
    return withRobots(response, directive);
  }
  if (blog?.kind === 'rewrite') {
    const rewritten = request.nextUrl.clone();
    rewritten.pathname = blog.path;
    return withRobots(NextResponse.rewrite(rewritten, { request: { headers: requestHeaders } }), directive);
  }

  if (parsed.prefix === '') {
    return withRobots(NextResponse.next({ request: { headers: requestHeaders } }), directive);
  }
  const rewritten = request.nextUrl.clone();
  rewritten.pathname = parsed.logicalPath;
  return withRobots(NextResponse.rewrite(rewritten, { request: { headers: requestHeaders } }), directive);
}

/** The cookie the language switcher writes; read only to choose a 307's target (OR-11). */
const LANG_COOKIE = 'lang';

/**
 * A language redirect with the headers of `url-shape.md` §3: a 307 depends on the
 * visitor, so it varies on what chose it and is never stored by a shared cache; a
 * 308 is a property of the URL, cached for a bounded hour because the channel
 * setting can be flipped (research R-5).
 */
function languageRedirect(request: NextRequest, parsed: Extract<LocaleParse, { kind: 'redirect' }>): NextResponse {
  const response = NextResponse.redirect(new URL(parsed.location, request.url), parsed.status);
  if (parsed.varyOnLanguageInputs) {
    response.headers.set('Vary', 'Accept-Language, Cookie');
    response.headers.set('Cache-Control', 'private, no-store');
  } else {
    response.headers.set('Cache-Control', 'public, max-age=3600');
  }
  return response;
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Vary', 'Accept-Language, Cookie');
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

/** The language, logical path and browser URL of a redirect's target, or `null`. */
function targetOf(
  location: string,
  languages: UrlLanguageState['languages'],
  aliases: UrlLanguageState['aliases'],
): { language: string; logicalPath: string; search: string; browserUrl: string } | null {
  const url = new URL(location, 'http://local.invalid');
  const reparsed = parseLocalePath({
    pathname: url.pathname,
    search: url.search,
    acceptLanguage: null,
    langCookie: null,
    languages,
    aliases,
  });
  if (reparsed.kind !== 'render') return null;
  return {
    language: reparsed.languageCode,
    logicalPath: stripLocalePrefix(url.pathname, { languages, aliases }),
    search: url.search,
    browserUrl: `${url.pathname}${url.search}`,
  };
}

/** The cookie a signed-in customer's session rides in (`lib/session.ts`). */
const SESSION_COOKIE = 'b2b_session';

/** The channel identity, or `null` when it could not be read. Never rejects. */
async function identityOf(channelCode: string | undefined): Promise<ChannelIdentity | null> {
  const read = await readChannelIdentity(channelCode);
  return read.kind === 'value' ? read.value : null;
}

/**
 * Stamps the resolved channel on a request no proxy stamped. A proxy's value is
 * left exactly as it arrived; with nothing known, nothing is stamped and the
 * backend resolves its default as it always did.
 */
function stampChannel(
  requestHeaders: Headers,
  inbound: string | undefined,
  identity: ChannelIdentity | null,
): void {
  if (inbound !== undefined || identity === null) return;
  requestHeaders.set(SALES_CHANNEL_REQUEST_HEADER, identity.code);
}

function withRobots(response: NextResponse, directive: RobotsDirective | null): NextResponse {
  stampRobotsResponse(response.headers, directive);
  return response;
}

function unavailable(request: NextRequest, requestHeaders: Headers): NextResponse {
  requestHeaders.set(UNAVAILABLE_HEADER, '1');
  requestHeaders.set(
    UNAVAILABLE_RETRY_HEADER,
    safeRetryTarget(`${request.nextUrl.pathname}${request.nextUrl.search}`),
  );
  return NextResponse.rewrite(new URL(SERVICE_UNAVAILABLE_PATH, request.url), {
    status: 503,
    headers: {
      'Retry-After': String(RETRY_AFTER_SECONDS),
      // A 503 that a shared cache kept would outlive the outage it reports.
      'Cache-Control': 'no-store',
    },
    request: { headers: requestHeaders },
  });
}

/**
 * Everything except the build's own script and style files.
 *
 * A literal, because Next reads `config` without running this file. What is a
 * *document* among the paths it lets through is `isDocumentPath`'s to say.
 */
export const config = {
  matcher: ['/((?!_next/static).*)'],
};
