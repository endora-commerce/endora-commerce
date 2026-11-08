import { ERROR_CODES, type SettingWriteValidator } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { SOFT_DELETE_RETENTION_DAYS_BOUNDS } from './settings-view.js';

/**
 * Issue #332 — the retention setting's write rule, contributed to `settings`'
 * validator registry so every write path (the generic Settings screen and its
 * API alike) refuses a value outside 1–3650 whole days. A value far enough out
 * made the purge date an invalid `Date`, and every asset and recursive folder
 * delete failed on it.
 */
export function createRetentionDaysValidator(): SettingWriteValidator {
  const { min, max } = SOFT_DELETE_RETENTION_DAYS_BOUNDS;
  return {
    contributorModuleId: 'assets_library',
    codes: ['assets.soft_delete_retention_days'],
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
        `Soft-delete retention must be a whole number of days from ${min} to ${max}.`,
        [{ path: 'value', issue: `Expected an integer from ${min} to ${max}` }],
      );
    },
  };
}
