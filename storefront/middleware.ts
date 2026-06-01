import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Forwards the incoming request's pathname as `x-pathname` so server
 * components (which don't otherwise receive the pathname) can branch on it.
 * Used by the root layout to render the **minimal checkout chrome**
 * (logo-only header, no Megamenu / Footer) on `/checkout*` routes per
 * feature 036 US5.
 *
 * The matcher excludes Next.js internals and static assets so this runs
 * only for actual page requests.
 */
export function middleware(request: NextRequest): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|woff|woff2|ttf|eot)$).*)',
  ],
};
