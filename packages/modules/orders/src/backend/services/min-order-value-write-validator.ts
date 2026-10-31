import {
  ERROR_CODES,
  hasAtMostTwoDecimals,
  type SettingWriteValidator,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ORDERS_SETTING_CODES } from '../../manifest.js';

/**
 * `orders`' answer to "is this minimum order value an amount" (issue #428).
 *
 * The minimum is a typed money amount, so it takes at most two decimal places
 * and more is refused with `400 AMOUNT_PRECISION_EXCEEDED`, never rounded — the
 * rule every other typed amount follows through `twoDecimalAmount`
 * (`specs/pricing/worked-examples.md` §10.17–§10.18). A setting's value is
 * checked by `settings` against its declared `valueType` only, so the rule
 * reaches this one through the settings-write seam. It judges the value the
 * write proposes, which is the same for a platform-wide and a per-channel
 * write. Pure: no I/O.
 */
export function createMinOrderValueValidator(): SettingWriteValidator {
  return {
    contributorModuleId: 'orders',
    codes: [ORDERS_SETTING_CODES.MIN_ORDER_VALUE],
    validate: async (input) => {
      const value = input.proposedValue;
      if (typeof value === 'number' && !hasAtMostTwoDecimals(value)) {
        throw new HttpError(
          400,
          ERROR_CODES.AMOUNT_PRECISION_EXCEEDED,
          'An amount has more than two decimal places.',
          // `setting`, not `code`: the envelope reads `details.code` as a
          // refusal token that picks the sentence (issue #569). The sentence is
          // the one every money field shares, so it names no setting.
          { setting: ORDERS_SETTING_CODES.MIN_ORDER_VALUE },
        );
      }
    },
  };
}
