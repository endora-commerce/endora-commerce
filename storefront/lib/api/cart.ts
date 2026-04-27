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
