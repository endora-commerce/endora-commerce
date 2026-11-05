'use server';

import { setOrganizationMfaPolicy } from '../../../lib/api/mfa';
import { StorefrontApiError } from '../../../lib/api/client';
import { getSessionCookie } from '../../../lib/session';
import { localeRedirect } from '../../../lib/i18n/navigation';

/**
 * The administrator's two-step verification requirement (feature 042, US3).
 * A refusal redirects with `?error=<code>` and never the API's sentence
 * (issue #740): the page names `FORBIDDEN` and reads anything else as its own
 * failure.
 */
export async function enforceAction(formData: FormData): Promise<void> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/account/organization-security');
  const enforce = formData.get('value') === 'true';
  try {
    await setOrganizationMfaPolicy(session, enforce);
  } catch (err) {
    const code = err instanceof StorefrontApiError && err.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'FAILED';
    return await localeRedirect(`/account/organization-security?error=${code}`);
  }
  return await localeRedirect('/account/organization-security?done=1');
}
