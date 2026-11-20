import {
  ERROR_CODES,
  RELATED_PAYERS_DEFAULT_TIME_ZONE,
  RELATED_PAYERS_SETTING_CODES,
  isIanaTimeZone,
  type SettingWriteValidator,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * `specs/182-related-payers/` RP-20 (a) — the time zone the daily limit's "today" starts in: the
 * **default store's**, `related_payers.time_zone` read for the system-default sales channel, so
 * every channel counts the same day. There is no platform-wide store time zone; the setting is the
 * module's own, as `tasks.time_zone` and `returns.time_zone` are. A zone the runtime does not know
 * falls back to the default rather than making the count throw.
 */
export function storeTimeZoneOf(deps: {
  readonly defaultChannelId: () => Promise<string>;
  readonly read: (code: string, salesChannelId: string) => Promise<unknown>;
}): () => Promise<string> {
  return async () => {
    const value = await deps.read(RELATED_PAYERS_SETTING_CODES.TIME_ZONE, await deps.defaultChannelId());
    return isIanaTimeZone(value) ? value : RELATED_PAYERS_DEFAULT_TIME_ZONE;
  };
}

/**
 * `related_payers.time_zone` must be a zone the runtime knows (`isIanaTimeZone`, the statement the
 * returns and tasks validators use) — a contribution into `settings`' validator registry.
 */
export function createRelatedPayersTimeZoneValidator(): SettingWriteValidator {
  return {
    contributorModuleId: 'related_payers',
    codes: [RELATED_PAYERS_SETTING_CODES.TIME_ZONE],
    validate: async (input) => {
      if (!isIanaTimeZone(input.proposedValue)) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The time zone must be an IANA time zone name, such as Europe/Warsaw.');
      }
    },
  };
}
