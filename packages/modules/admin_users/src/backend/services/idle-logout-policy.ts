import type { SettingsReadPort } from '@endora-commerce/platform/kernel';

/** The operator's inactivity sign-out window for the Admin UI, in minutes. */
export const IDLE_LOGOUT_SETTING_CODE = 'admin.idle_logout_minutes';

/**
 * The configured idle-logout window, for `GET /api/v1/admin/me`.
 *
 * Read through `settingsReadPort` with `salesChannelId: null` — the policy is
 * platform-wide, an administrator not being per-storefront — and through
 * `getMany` rather than `get`, because `getMany` answers a per-code result
 * where `get` throws. The auth-gate response must not fail over a policy value:
 * an instance whose settings store does not carry the code, or carries
 * something that is not a positive number, answers `null`, and the Admin UI
 * applies its built-in default exactly as it does for a backend that predates
 * the field. Nothing is caught here, so a real failure of the store still
 * propagates.
 */
export async function readIdleLogoutMinutes(
  settings: Pick<SettingsReadPort, 'getMany'>,
): Promise<number | null> {
  const row = (await settings.getMany([IDLE_LOGOUT_SETTING_CODE], null)).get(
    IDLE_LOGOUT_SETTING_CODE,
  );
  if (row?.ok !== true) return null;
  const minutes = Number(row.value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}
