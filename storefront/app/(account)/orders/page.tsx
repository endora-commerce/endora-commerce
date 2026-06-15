import { redirect } from 'next/navigation';

/**
 * Legacy `/account/orders` location. The orders list now lives at `/orders`
 * (alongside the single order view); keep this path working for existing
 * links, bookmarks, and post-checkout redirects.
 */
export default function AccountOrdersRedirect(): never {
  redirect('/orders');
}
