import { ERROR_CODES, type SettingWriteValidator } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { RETENTION_DAYS_BOUNDS } from './retention-sweeper.js';

/**
 * `customer_notifications.retention_days` is held to 7–730 whole days at every
 * write path (research R-16), contributed to `settings`' validator registry so
 * the generic Settings screen and its API refuse the same values.
 */
export function createRetentionDaysValidator(): SettingWriteValidator {
  const { min, max } = RETENTION_DAYS_BOUNDS;
  return {
    contributorModuleId: 'customer_notifications',
    codes: ['customer_notifications.retention_days'],
    async validate({ proposedValue }) {
      if (
        typeof proposedValue === 'number' &&
        Number.isInteger(proposedValue) &&
        proposedValue >= min &&
        proposedValue <= max
      ) {
        return;
      }
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        `Notification retention must be a whole number of days from ${min} to ${max}.`,
        [{ path: 'value', issue: `Expected an integer from ${min} to ${max}` }],
      );
    },
  };
}
