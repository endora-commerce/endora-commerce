import {
  CONTACT_FORM_MAX_RECIPIENTS,
  ERROR_CODES,
  contactFormEmailSchema,
  type SettingWriteValidator,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { CMS_SETTING_CODES } from '../../../manifest.js';

/**
 * Feature 169 (T095, data-model §3.1) — the contact form's recipients take 0–10 e-mail
 * addresses, contributed to `settings`' validator registry so the generic Settings screen and
 * its API refuse anything else, per channel or for all of them.
 */
export function createContactFormRecipientsValidator(): SettingWriteValidator {
  return {
    contributorModuleId: 'cms',
    codes: [CMS_SETTING_CODES.CONTACT_FORM_RECIPIENTS],
    async validate({ proposedValue }) {
      if (
        Array.isArray(proposedValue) &&
        proposedValue.length <= CONTACT_FORM_MAX_RECIPIENTS &&
        proposedValue.every((entry) => typeof entry === 'string' && contactFormEmailSchema.safeParse(entry).success)
      ) {
        return;
      }
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Contact form recipients must be a list of at most ${CONTACT_FORM_MAX_RECIPIENTS} e-mail addresses.`,
        [{ path: 'value', issue: `Expected 0 to ${CONTACT_FORM_MAX_RECIPIENTS} e-mail addresses` }],
      );
    },
  };
}
