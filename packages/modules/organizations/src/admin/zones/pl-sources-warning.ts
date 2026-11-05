/**
 * Feature 173 — when the Settings screen warns beside the Polish-sources
 * setting (`specs/173-registration-registry-lookup/contracts/admin-surfaces.md`
 * §2a; FR-026a): only for that setting, only while the draft is `gus`, and only
 * when the stored GUS credential reference is empty — `gus` with no GUS
 * credential means no lookup for Polish NIPs at all.
 *
 * It checks emptiness only: whether a selected credential actually resolves is
 * not knowable on that screen without a new endpoint, so the setting's
 * description covers that remainder. An unreadable reference warns nothing —
 * the description still says it in words — and the zone never blocks a save.
 */

export const PL_SOURCES_SETTING_CODE = 'organizations.registration.registry_lookup_pl_sources';
export const GUS_CREDENTIALS_SETTING_CODE = 'organizations.registration.gus_credentials';

export function showPlSourcesWarning(input: {
  settingCode: string;
  draftText: string;
  /** The stored GUS credential reference; `null` while unknown or unreadable. */
  credentialReference: string | null;
}): boolean {
  if (input.settingCode !== PL_SOURCES_SETTING_CODE) return false;
  if (input.draftText.trim() !== 'gus') return false;
  return input.credentialReference !== null && input.credentialReference.trim() === '';
}

/** The reference from `GET /api/v1/admin/settings/:code`; `null` when the answer is not readable as one. */
export function credentialReferenceOf(answer: unknown): string | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const { globalValue, defaultValue } = answer as { globalValue?: unknown; defaultValue?: unknown };
  const value = globalValue ?? defaultValue ?? '';
  return typeof value === 'string' ? value : null;
}
