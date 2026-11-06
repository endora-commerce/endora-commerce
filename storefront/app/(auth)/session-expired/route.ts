import { NextResponse, type NextRequest } from 'next/server';
import { clearSessionCookie } from '../../../lib/session';
import { localizedPath } from '../../../lib/i18n/navigation';
import { clearQuickOrderPreview } from '../../../lib/quick-order-preview-cookie';

export async function GET(req: NextRequest): Promise<Response> {
  await clearSessionCookie();
  // Issue #790 — the quick-order preview is the buyer's uploaded data; it ends with the session.
  await clearQuickOrderPreview();
  const next = req.nextUrl.searchParams.get('next') ?? '/account';
  // Feature 167 — the sign-in page in the current language; `next` is kept as given
  // (the layout sends it prefixed) and localized again by the login page on use.
  const url = new URL(await localizedPath(`/login?next=${encodeURIComponent(next)}`), req.url);
  return NextResponse.redirect(url);
}
