'use server';

import { getMe } from '../api/account';
import { upsertQuickOrderPreference } from '../api/quick-order';
import { getSessionCookie } from '../session';
import { localeRedirect } from '../i18n/navigation';
import { PREFERENCES_ERRORS } from '../account/settings-errors';

/**
 * The ordering preferences page's one server action (feature 039 / US2, issue
 * #359). The page renders two forms — the buyer's own defaults, and for an
 * Organization's Administrator the organization defaults every member inherits
 * — and each posts its `scope`. The id the scope is about is never read from
 * the form: it is the caller's own account or Organization, from `/me`. The
 * API's guard (`routes.preferences.ts`) is the boundary; a member posting
 * `scope=organization` is refused there.
 */
export async function saveOrderingPreferencesAction(formData: FormData): Promise<void> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/preferences');
  const me = await getMe(session);

  const field = (name: string): string | null => {
    const value = ((formData.get(name) as string | null) ?? '').trim();
    return value.length > 0 ? value : null;
  };
  const organization = formData.get('scope') === 'organization';
  const organizationId = me.customerAccount.organizationId ?? me.organization?.id ?? null;
  if (organization && !organizationId) {
    return await localeRedirect('/preferences?error=SAVE_FAILED');
  }

  try {
    await upsertQuickOrderPreference(session, {
      scope: organization ? 'organization' : 'customer',
      scopeId: organization ? organizationId! : me.customerAccount.id,
      defaultPaymentMethodId: field('defaultPaymentMethodId'),
      defaultDeliveryMethodId: field('defaultDeliveryMethodId'),
      defaultBillingAddressId: field('defaultBillingAddressId'),
      defaultShippingAddressId: field('defaultShippingAddressId'),
    });
  } catch (err) {
    return await localeRedirect(`/preferences?error=${PREFERENCES_ERRORS.failureCode(err, 'SAVE_FAILED')}`);
  }
  return await localeRedirect(organization ? '/preferences?saved=organization' : '/preferences?saved=1');
}
