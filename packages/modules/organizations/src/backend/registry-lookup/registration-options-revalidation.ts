/**
 * Feature 173 — dropping the storefront's cached registration options when an
 * operator changes a registration setting (research R-11; FR-025).
 *
 * The storefront reads `GET /api/v1/organizations/registration-options` under
 * the Next tag {@link REGISTRATION_OPTIONS_CACHE_TAG} for up to 300 s; this
 * revalidates the tag on `settings.value_changed` for the switch and the GUS
 * credential, so the change shows on the next page in the common case. The
 * Polish-sources mode is deliberately not one of them: the answer does not
 * reflect it. The `google_tag_manager` precedent.
 */

export const REGISTRATION_OPTIONS_CACHE_TAG = 'organizations:registration-options';

const REVALIDATING_CODES: ReadonlySet<string> = new Set([
  'organizations.registration.registry_lookup_enabled',
  'organizations.registration.gus_credentials',
]);

export function registrationOptionsRevalidation(revalidator: {
  revalidate(tags: string[]): Promise<void>;
}): (payload: unknown) => Promise<void> {
  return async (payload) => {
    const settingCode = (payload as { settingCode?: unknown } | null)?.settingCode;
    if (typeof settingCode !== 'string' || !REVALIDATING_CODES.has(settingCode)) return;
    await revalidator.revalidate([REGISTRATION_OPTIONS_CACHE_TAG]);
  };
}
