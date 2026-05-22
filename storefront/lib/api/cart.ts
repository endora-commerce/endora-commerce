import { apiMutate, extractSessionCookieValue } from './mutations';
import type { RequestContext } from './client';

/**
 * Cart API bindings (T156). The backend cart accepts either an
 * authenticated `b2b_session` or an anonymous `b2b_cart_anon` cookie —
 * either or neither, in which case the first POST mints a fresh anon
 * token and Set-Cookies it back to us.
 *
 * Server actions thread both cookie values through `cookieJar` and
 * inspect `setCookie` on the result so they can persist any newly minted
 * `b2b_cart_anon` value via next/headers cookies().set().
 */

export interface CartItem {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: { amount: number; currency: string };
}

export interface CartSummary {
  id: string | null;
  customerAccountId: string | null;
  organizationId: string | null;
  anonymousCartToken: string | null;
  items: CartItem[];
  itemCount: number;
  subtotal: { amount: number; currency: string };
}

export interface CartCookieJar {
  session?: string | null;
  anon?: string | null;
}

export interface CartResult {
  cart: CartSummary;
  /** New `b2b_cart_anon` value the storefront should persist, if minted. */
  newAnonCookie: string | null;
}

const baseUrl = process.env['BACKEND_BASE_URL'] ?? 'http://localhost:3001';

export async function getCart(jar: CartCookieJar, ctx?: RequestContext): Promise<CartResult> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (ctx?.salesChannelCode) headers['X-Sales-Channel'] = ctx.salesChannelCode;
  if (ctx?.locale) headers['Accept-Language'] = ctx.locale;
  const cookie = combineCookies(jar);
  if (cookie) headers['Cookie'] = cookie;
  const response = await fetch(`${baseUrl}/api/v1/cart`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`GET /cart failed with ${response.status}`);
  const payload = (await response.json()) as { data: CartSummary };
  return { cart: payload.data, newAnonCookie: extractAnonCookie(response.headers) };
}

export async function addCartItem(
  jar: CartCookieJar,
  payload: { productId: string; variantId?: string; quantity: number },
  ctx?: RequestContext,
): Promise<CartResult> {
  const result = await apiMutate<CartSummary>({
    method: 'POST',
    path: '/api/v1/cart/items',
    body: payload,
    rawCookieHeader: combineCookies(jar) || null,
    ...(ctx ? { ctx } : {}),
  });
  return { cart: result.data!, newAnonCookie: extractAnonCookieFromHeaders(result.setCookie) };
}

export async function updateCartItem(
  jar: CartCookieJar,
  itemId: string,
  quantity: number,
  ctx?: RequestContext,
): Promise<CartResult> {
  const result = await apiMutate<CartSummary>({
    method: 'PATCH',
    path: `/api/v1/cart/items/${itemId}`,
    body: { quantity },
    rawCookieHeader: combineCookies(jar) || null,
    ...(ctx ? { ctx } : {}),
  });
  return { cart: result.data!, newAnonCookie: extractAnonCookieFromHeaders(result.setCookie) };
}

export async function removeCartItem(
  jar: CartCookieJar,
  itemId: string,
  ctx?: RequestContext,
): Promise<CartResult> {
  const result = await apiMutate<CartSummary>({
    method: 'DELETE',
    path: `/api/v1/cart/items/${itemId}`,
    rawCookieHeader: combineCookies(jar) || null,
    ...(ctx ? { ctx } : {}),
  });
  return { cart: result.data!, newAnonCookie: extractAnonCookieFromHeaders(result.setCookie) };
}

// ──────────────────────────────────────────────────────────────────────
//  Feature 027 — coupon / conversions / approval
// ──────────────────────────────────────────────────────────────────────

export interface ApplyCouponOk {
  outcome: 'applied';
  cart: CartSummary;
}

export interface ApplyCouponRejected {
  outcome: 'rejected';
  reason:
    | 'invalid_code'
    | 'expired'
    | 'below_min_spend'
    | 'wrong_channel'
    | 'wrong_customer_group'
    | 'wrong_organization'
    | 'coupon_format_invalid';
  shortfall?: { amount: number; currency: string };
}

export type ApplyCouponResult = ApplyCouponOk | ApplyCouponRejected;

export async function applyCartCoupon(
  jar: CartCookieJar,
  code: string | null,
  ctx?: RequestContext,
): Promise<ApplyCouponResult> {
  try {
    const result = await apiMutate<CartSummary>({
      method: 'POST',
      path: '/api/v1/cart/coupon',
      body: { code },
      rawCookieHeader: combineCookies(jar) || null,
      ...(ctx ? { ctx } : {}),
    });
    return { outcome: 'applied', cart: result.data! };
  } catch (err) {
    // The backend emits a typed 422 with `details.reason` on rejection.
    // The storefront's apiMutate wrapper throws a StorefrontApiError —
    // we inspect its raw body for the reason. Callers see a typed
    // `rejected` outcome instead of a thrown exception.
    if (err && typeof err === 'object' && 'details' in err) {
      const d = (err as { details?: { reason?: string; shortfall?: { amount: number; currency: string } } })
        .details;
      if (d?.reason) {
        return {
          outcome: 'rejected',
          reason: d.reason as ApplyCouponRejected['reason'],
          ...(d.shortfall ? { shortfall: d.shortfall } : {}),
        };
      }
    }
    throw err;
  }
}

export async function clearCartCoupon(
  jar: CartCookieJar,
  ctx?: RequestContext,
): Promise<CartSummary> {
  const result = await apiMutate<CartSummary>({
    method: 'DELETE',
    path: '/api/v1/cart/coupon',
    rawCookieHeader: combineCookies(jar) || null,
    ...(ctx ? { ctx } : {}),
  });
  return result.data!;
}

export async function convertCartToQuoteRequest(
  jar: CartCookieJar,
  note: string | null,
  ctx?: RequestContext,
): Promise<{ quoteRequestId: string; quoteRequestSlug: string }> {
  const result = await apiMutate<{
    quoteRequestId: string;
    cartId: string;
    quoteRequestSlug: string;
  }>({
    method: 'POST',
    path: '/api/v1/cart/convert-to-quote-request',
    body: note ? { note } : {},
    rawCookieHeader: combineCookies(jar) || null,
    ...(ctx ? { ctx } : {}),
  });
  return {
    quoteRequestId: result.data!.quoteRequestId,
    quoteRequestSlug: result.data!.quoteRequestSlug,
  };
}

export async function submitCartForApproval(
  jar: CartCookieJar,
  ctx?: RequestContext,
): Promise<void> {
  await apiMutate({
    method: 'POST',
    path: '/api/v1/cart/submit-for-approval',
    rawCookieHeader: combineCookies(jar) || null,
    ...(ctx ? { ctx } : {}),
  });
}

export async function touchCart(jar: CartCookieJar, ctx?: RequestContext): Promise<void> {
  await apiMutate({
    method: 'POST',
    path: '/api/v1/cart/touch',
    rawCookieHeader: combineCookies(jar) || null,
    ...(ctx ? { ctx } : {}),
  });
}

export interface OrgCartSummary {
  id: string;
  ownerCustomerAccountId: string;
  ownerDisplayName: string;
  status: 'active' | 'abandoned' | 'completed' | 'rejected';
  approvalStatus: 'not_required' | 'pending' | 'approved' | 'rejected_by_org_admin';
  itemCount: number;
  total: { amount: number; currency: string };
  lastActivityAt: string;
  submittedForApprovalAt: string | null;
}

export interface OrgCartsListResponse {
  data: OrgCartSummary[];
  meta: { page: number; pageSize: number; totalCount: number };
}

/**
 * Feature 027 US4 — list every cart in the caller's Organization.
 * Requires the caller's CustomerAccount.role === 'organization_admin';
 * a 403 is returned otherwise.
 */
export async function listOrganizationCarts(
  jar: CartCookieJar,
  filter?: {
    status?: ReadonlyArray<'active' | 'abandoned' | 'completed' | 'rejected'>;
    approvalStatus?: ReadonlyArray<
      'not_required' | 'pending' | 'approved' | 'rejected_by_org_admin'
    >;
    page?: number;
  },
  ctx?: RequestContext,
): Promise<OrgCartsListResponse> {
  const params = new URLSearchParams();
  if (filter?.status?.length) params.set('status', filter.status.join(','));
  if (filter?.approvalStatus?.length) params.set('approvalStatus', filter.approvalStatus.join(','));
  if (filter?.page) params.set('page', String(filter.page));
  const qs = params.toString();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (ctx?.salesChannelCode) headers['X-Sales-Channel'] = ctx.salesChannelCode;
  const cookie = combineCookies(jar);
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(
    `${baseUrl}/api/v1/organization/carts${qs ? `?${qs}` : ''}`,
    { headers, credentials: 'include' as RequestCredentials },
  );
  if (!res.ok) {
    throw new Error(`organization/carts list failed with HTTP ${res.status}`);
  }
  return (await res.json()) as OrgCartsListResponse;
}

/**
 * `apiMutate.sessionCookie` only carries one cookie pair, so combine
 * both candidates into the Cookie header verbatim. This keeps the
 * helper signature stable while supporting authenticated + anon paths.
 */
function combineCookies(jar: CartCookieJar): string {
  const parts: string[] = [];
  if (jar.session) parts.push(`b2b_session=${jar.session}`);
  if (jar.anon) parts.push(`b2b_cart_anon=${jar.anon}`);
  return parts.join('; ');
}

function extractAnonCookie(headers: Headers): string | null {
  const setCookieHeaders =
    (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return extractAnonCookieFromHeaders(setCookieHeaders);
}

function extractAnonCookieFromHeaders(setCookie: string[]): string | null {
  for (const header of setCookie) {
    const match = /(?:^|;\s*)?b2b_cart_anon=([^;]+)/.exec(header);
    if (match) return match[1] ?? null;
  }
  return null;
}

// Re-exported so callers can identify a session-cookie roundtrip on login flows
// that route through cart endpoints (rare, but kept for completeness).
export { extractSessionCookieValue };
