import { ERROR_CODES, isIanaTimeZone, type SettingWriteValidator } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { RETURNS_SETTING_CODES } from '../../manifest.js';

/**
 * `returns.time_zone` must be a time zone the runtime knows (`isIanaTimeZone`,
 * the statement the reporting time zone uses too): the free-return window and
 * the withdrawal period count calendar days in it, and an unknown zone would
 * make the counting throw a `RangeError` (issue #905). `tasks`'
 * `time-zone-validator.ts`, copied — a module's internals are not another
 * module's to import, and the helper is too small to widen the platform's
 * published surface for.
 */
export function isKnownTimeZone(value: unknown): value is string {
  return isIanaTimeZone(value);
}

export function createReturnsTimeZoneValidator(): SettingWriteValidator {
  return {
    contributorModuleId: 'returns',
    codes: [RETURNS_SETTING_CODES.TIME_ZONE],
    validate: async (input) => {
      if (!isKnownTimeZone(input.proposedValue)) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'The time zone must be an IANA time zone name, such as Europe/Warsaw.',
        );
      }
    },
  };
}
