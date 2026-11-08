import { NextResponse, type NextRequest } from 'next/server';
import { clearSessionCookie } from '../../../lib/session';
import { localizedPath } from '../../../lib/i18n/navigation';

export async function GET(req: NextRequest): Promise<Response> {
  await clearSessionCookie();
  // Issue #809 — the quick-order preview is the backend's, bound to the session that has just
  // expired: nothing can read it any more, and its TTL ends it.
  const next = req.nextUrl.searchParams.get('next') ?? '/account';
  // Feature 167 — the sign-in page in the current language; `next` is kept as given
  // (the layout sends it prefixed) and localized again by the login page on use.
  const url = new URL(await localizedPath(`/login?next=${encodeURIComponent(next)}`), req.url);
  return NextResponse.redirect(url);
}
