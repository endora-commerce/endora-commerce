'use server';

import { revalidatePath } from 'next/cache';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import {
  markAllCustomerNotificationsRead,
  markCustomerNotificationRead,
} from '../../../../lib/api/customer-notifications';

/**
 * The two writes of `/account/notifications`
 * (`specs/179-rfq-and-customer-notifications/` FR-050a, FR-050b, FR-051a).
 *
 * Both revalidate the root layout, so the account entry's unread count in the
 * header, the tab bar and the drawer re-renders in the same response, and both
 * answer with a redirect back to the page: `?marked=all` for the status region
 * after *Mark all as read*, `?markError=1` after a failure — the `pushSaved` /
 * `pushError` pattern of the profile page. Under impersonation the API answers
 * as if it marked and writes nothing (FR-045); the page shows the controls
 * disabled, so neither is normally reached then.
 */

const PAGE = '/account/notifications';

/** *Mark as read* on an entry without a link; returns to the page it was on. */
export async function markReadAction(formData: FormData): Promise<void> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect(`/login?next=${PAGE}`);
  const id = String(formData.get('id') ?? '');
  const cursor = String(formData.get('cursor') ?? '');
  const { ctx } = await getServerContext();
  let failed = false;
  try {
    await markCustomerNotificationRead(session, ctx, id);
  } catch {
    failed = true;
  }
  revalidatePath('/', 'layout');
  // Outside the `try`: `redirect` throws by design.
  if (failed) return await localeRedirect(`${PAGE}?markError=1`);
  return await localeRedirect(cursor ? `${PAGE}?${new URLSearchParams({ cursor }).toString()}` : PAGE);
}

/** *Mark all as read*; lands on the first page, where the status region says it is done. */
export async function markAllReadAction(_formData: FormData): Promise<void> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect(`/login?next=${PAGE}`);
  const { ctx } = await getServerContext();
  let failed = false;
  try {
    await markAllCustomerNotificationsRead(session, ctx);
  } catch {
    failed = true;
  }
  revalidatePath('/', 'layout');
  return await localeRedirect(failed ? `${PAGE}?markError=1` : `${PAGE}?marked=all`);
}
