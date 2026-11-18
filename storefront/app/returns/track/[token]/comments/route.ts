import { addTrackedComment } from '../../../../../lib/api/returns-guest';
import { StorefrontApiError } from '../../../../../lib/api/client';
import { localizePath } from '../../../../../lib/i18n/locale-path';
import { forwardedForOf } from '../../../../../lib/returns/guest';
import { getServerContext } from '../../../../../lib/server-context';

export const dynamic = 'force-dynamic';

/**
 * `POST /returns/track/[token]/comments` — the tracking page's message form, without
 * JavaScript (`specs/181-guest-complaints/` contract G9, FR-042; design review S-7, F-15):
 * the body forwarded with the token as a header, then `303` back to the conversation, its
 * heading the fragment, with the result as a fixed code — never a sentence — in the address.
 * A link that no longer opens the case goes back to the page, which answers the neutral page.
 */
function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

/** The outcome codes, each a literal address suffix — never a value built into the URL (issues #790, #810). */
type Outcome = 'added' | 'comments_per_case' | 'rate_limited' | 'closed' | 'refused';
const OUTCOMES: Readonly<Record<Outcome, string>> = {
  added: '?comment=added#conversation',
  comments_per_case: '?comment=comments_per_case#conversation',
  rate_limited: '?comment=rate_limited#conversation',
  closed: '?comment=closed#conversation',
  refused: '?comment=refused#conversation',
};

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const { ctx, urlState } = await getServerContext();
  const page = urlState ? localizePath(`/returns/track/${token}`, urlState) : `/returns/track/${token}`;
  const result = (code: Outcome): Response => seeOther(`${page}${OUTCOMES[code]}`);
  let body = '';
  try {
    const value = (await request.formData()).get('body');
    body = typeof value === 'string' ? value.trim() : '';
  } catch {
    body = '';
  }
  if (!body) return result('refused');
  try {
    await addTrackedComment(token, body.slice(0, 2000), { ctx, forwardedFor: forwardedForOf(request) });
    return result('added');
  } catch (error) {
    if (!(error instanceof StorefrontApiError)) return result('refused');
    const details = (error.details ?? {}) as Record<string, unknown>;
    if (error.status === 404) return seeOther(page);
    if (error.code === 'RETURN_GUEST_LIMIT_REACHED' && details['limit'] === 'comments_per_case') return result('comments_per_case');
    if (error.status === 429) return result('rate_limited');
    if (error.status === 409 || error.code === 'RETURN_COMMENTS_CLOSED') return result('closed');
    return result('refused');
  }
}
