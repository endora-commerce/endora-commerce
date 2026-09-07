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

/**
 * Forwards the incoming request's pathname as `x-pathname` so server
 * components (which don't otherwise receive the pathname) can branch on it.
 * Used by the root layout to render the **minimal checkout chrome**
 * (logo-only header, no Megamenu / Footer) on `/checkout*` routes per
 * feature 036 US5.
 *
 * The matcher excludes Next.js internals and static assets so this runs
 * only for actual page requests.
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
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);

  const decision = gateDecision({
    pathname: request.nextUrl.pathname,
    prefetch: request.headers.get('next-router-prefetch') !== null,
  });
  if (decision === 'unavailable') return unavailable(request, requestHeaders);
  if (decision === 'ask' && (await backendReachability()) === 'unreachable') {
    return unavailable(request, requestHeaders);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
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

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|woff|woff2|ttf|eot)$).*)',
  ],
};
