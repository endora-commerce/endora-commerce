'use server';

import { approveOrganizationCart, rejectOrganizationCart } from '../../../../../lib/api/cart';
import { getAnonCartCookie, getSessionCookie } from '../../../../../lib/session';
import { getServerContext } from '../../../../../lib/server-context';
import { localeRedirect } from '../../../../../lib/i18n/navigation';
import { orgCartFailureCode, parseRejectReason } from '../../../../../lib/account/org-cart-approval';

/**
 * The Organization administrator's two answers to a pending cart (issue #650).
 * Each redirects back to the cart with `?done=…` or `?error=<code>`; the role
 * and the Organization are the API's to check, and a refusal is reported by its
 * code (`lib/account/org-cart-approval.ts` says why a code and not a sentence).
 */

export async function approveCartAction(formData: FormData): Promise<void> {
  const cartId = cartIdOf(formData);
  if (!cartId) return await localeRedirect('/organization/carts');
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const anon = await getAnonCartCookie();
  const { ctx } = await getServerContext();
  try {
    await approveOrganizationCart({ session, ...(anon ? { anon } : {}) }, cartId, ctx);
  } catch (err) {
    return await localeRedirect(`${detailPath(cartId)}?error=${orgCartFailureCode(err)}`);
  }
  return await localeRedirect(`${detailPath(cartId)}?done=approved`);
}

export async function rejectCartAction(formData: FormData): Promise<void> {
  const cartId = cartIdOf(formData);
  if (!cartId) return await localeRedirect('/organization/carts');
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const parsed = parseRejectReason(formData.get('reason'));
  if (!parsed.ok) return await localeRedirect(`${detailPath(cartId)}?error=${parsed.code}`);
  const anon = await getAnonCartCookie();
  const { ctx } = await getServerContext();
  try {
    await rejectOrganizationCart({ session, ...(anon ? { anon } : {}) }, cartId, parsed.reason, ctx);
  } catch (err) {
    return await localeRedirect(`${detailPath(cartId)}?error=${orgCartFailureCode(err)}`);
  }
  return await localeRedirect(`${detailPath(cartId)}?done=rejected`);
}

function cartIdOf(formData: FormData): string | null {
  const value = formData.get('cartId');
  return typeof value === 'string' && value !== '' ? value : null;
}

function detailPath(cartId: string): string {
  return `/organization/carts/${encodeURIComponent(cartId)}`;
}
