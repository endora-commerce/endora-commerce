import {
  ERROR_CODES,
  type NumberingSeries,
  type SettingWriteValidationInput,
  type SettingWriteValidator,
} from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { INVOICES_SETTING_CODES } from '../manifest.js';
import {
  findNumberPatternCollisions,
  patternSequenceDefect,
} from './invoice-number-collisions.js';
import { effectivePattern, type InvoiceKind } from './invoice-number-generator.js';

const KIND_BY_SETTING_CODE: Record<string, InvoiceKind> = {
  [INVOICES_SETTING_CODES.NUMBERING_INVOICE_PATTERN]: 'invoice',
  [INVOICES_SETTING_CODES.NUMBERING_PROFORMA_PATTERN]: 'proforma',
  [INVOICES_SETTING_CODES.NUMBERING_CORRECTION_PATTERN]: 'correction',
};

/**
 * `invoices`' answer to "is this numbering configuration legal" — feature 078,
 * D-95.2.
 *
 * `settings` hands over what every channel's value would be after the write;
 * this decides whether two of them can render one string. It refuses a
 * **possible** collision, not an actual one, and that asymmetry with the
 * issuance refusal is the point: at a settings write the operator is
 * configuring and nothing is at stake, so a conservative refusal costs them one
 * edit; at issuance a customer's document is at stake, so only a duplicate the
 * database has actually rejected is refused.
 *
 * The predicate is over the **post-write state**, not over the delta, so
 * re-saving a value that already collides is refused too. That is what an
 * operator needs: the question is whether the configuration they are about to
 * confirm is one the platform can number, not whether they changed anything.
 *
 * Pure: no I/O. Everything it needs is in the projection.
 */
export function createNumberingPatternValidator(): SettingWriteValidator {
  return {
    contributorModuleId: 'invoices',
    codes: Object.keys(KIND_BY_SETTING_CODE),
    validate: async (input) => {
      refuseIllegalNumbering(input);
    },
  };
}

function refuseIllegalNumbering(input: SettingWriteValidationInput): void {
  const kind = KIND_BY_SETTING_CODE[input.code];
  if (kind === undefined) return;

  const series: NumberingSeries[] = input.projection.map((channel) => ({
    salesChannelId: channel.salesChannelId,
    salesChannelCode: channel.salesChannelCode,
    salesChannelName: channel.salesChannelName,
    pattern: effectivePattern(kind, typeof channel.value === 'string' ? channel.value : null),
  }));

  // A pattern with no sequence token renders one string for a whole year, so it
  // collides with itself on the second document — a self-collision the pairwise
  // sweep would never look for. Checked on the series this write sets: a
  // platform-wide write reaches every channel without its own row, so it is
  // checked against all of them.
  const targeted = new Set(input.targetedChannelIds);
  const written = targeted.size > 0
    ? series.filter((one) => targeted.has(one.salesChannelId))
    : series;
  if (written.some((one) => patternSequenceDefect(one.pattern) !== null)) {
    throw new HttpError(
      400,
      ERROR_CODES.INVOICE_NUMBER_PATTERN_COLLIDES,
      'This numbering pattern has no sequence token, so every document in this sales ' +
        'channel would be given the same number.',
      { code: 'no_sequence_token', kind },
    );
  }

  const [collision] = findNumberPatternCollisions(series);
  if (collision === undefined) return;

  // Name the channel the operator is *not* editing — that is the one they have
  // to reason about. A platform-wide write targets nobody, so either side is as
  // informative as the other.
  const other = targeted.has(collision.a.salesChannelId) ? collision.b : collision.a;

  throw new HttpError(
    400,
    ERROR_CODES.INVOICE_NUMBER_PATTERN_COLLIDES,
    `This numbering pattern can produce the same document number as sales channel ` +
      `"${other.salesChannelName}".`,
    {
      code: 'other_channel',
      kind,
      channel: other.salesChannelName,
      channelCode: other.salesChannelCode,
      // Never interpolated into a sentence: a pattern contains `{seq}`, and the
      // envelope discards a translation with an unfilled placeholder whole. It
      // travels here for the admin UI to render outside the message.
      otherPattern: other.pattern,
      example: collision.example,
    },
  );
}
