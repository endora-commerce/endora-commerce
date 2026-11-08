'use server';

import { logoutCustomer } from '../api/auth';
import { clearSessionCookie, getSessionCookie } from '../session';
import { localeRedirect } from '../i18n/navigation';
import { clearQuickOrderPreview } from '../api/quick-order-preview';

/**
 * Ends the buyer's session and sends them to the sign-in page.
 *
 * Shared by the account area and the no-access screen
 * (`components/ChannelAccessDenied.tsx`), which is reached on any page of a
 * store the account may not use — so it cannot live in one route's file.
 */
export async function signOutAction(): Promise<void> {
  const session = await getSessionCookie();
  // Issues #790, #809 — the quick-order preview is the buyer's uploaded data, so it ends with the
  // session. The backend keeps it bound to the session, so it is dropped while the session can
  // still name it. Best effort: signing out never waits on it, and the backend's TTL ends it anyway.
  if (session) await clearQuickOrderPreview(session).catch(() => undefined);
  await logoutCustomer(session);
  await clearSessionCookie();
  return await localeRedirect('/login');
}
