import { defineUrlErrors } from '../url-errors';

/**
 * What `/account/password` and `/preferences` say about a refused save
 * (issue #745). **A code travels, never a sentence** — see `lib/url-errors.ts`.
 */
export const PASSWORD_ERRORS = defineUrlErrors({
  api: {
    CURRENT_PASSWORD_INVALID: 'account.password.error.CURRENT_PASSWORD_INVALID',
    VALIDATION_FAILED: 'account.password.error.VALIDATION_FAILED',
  },
  own: { CHANGE_FAILED: 'account.password.failed' },
  generic: 'CHANGE_FAILED',
});

export const PREFERENCES_ERRORS = defineUrlErrors({
  api: {},
  own: { SAVE_FAILED: 'account.preferences.failed' },
  generic: 'SAVE_FAILED',
});
