import type { EntityManager } from '@mikro-orm/postgresql';
import {
  DictionaryReferenceError,
  ERROR_CODES,
  type DictionaryValidator,
  type DictionaryWriteMode,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * The checks an Organization write makes before its Command runs, shared by
 * the admin create (`POST /api/v1/admin/organizations`) and
 * `organizationWritePort` (issue #1029) so the two cannot drift apart.
 */

/**
 * Refuses a channel id that names no channel — one deleted while the form was
 * open, or a mistyped id from an API caller — with a field error naming its
 * position, before anything is written. An inactive channel is a channel, and
 * an Organization may be assigned to one.
 *
 * `code` is the admin route's `VALIDATION_FAILED` by default; the write port
 * answers `UNKNOWN_SALES_CHANNEL`, so a caller can tell it from a malformed
 * input without reading the details.
 */
export async function assertSalesChannelsExist(
  em: EntityManager,
  salesChannelIds: readonly string[],
  code: typeof ERROR_CODES.VALIDATION_FAILED | typeof ERROR_CODES.UNKNOWN_SALES_CHANNEL = ERROR_CODES.VALIDATION_FAILED,
): Promise<void> {
  const known = new Set(
    (
      await em.find(SalesChannel, { id: { $in: [...new Set(salesChannelIds)] } }, { fields: ['id'] })
    ).map((c) => c.id),
  );
  const unknown = salesChannelIds
    .map((id, index) => ({ id, index }))
    .filter(({ id }) => !known.has(id));
  if (unknown.length === 0) return;
  throw new HttpError(
    422,
    code,
    'One or more of the sales channels do not exist. Reload and choose again.',
    unknown.map(({ id, index }) => ({ path: `salesChannelIds.${index}`, issue: id })),
  );
}

/**
 * The country check self-registration makes (`RegistrationService`), with the
 * same answer: 409 and the Dictionary's code on the address field.
 */
export async function assertCountryAvailable(
  validator: Pick<DictionaryValidator, 'validateCountryCode'> | undefined,
  country: string,
  mode: DictionaryWriteMode = 'create-or-change',
): Promise<void> {
  if (!validator) return;
  try {
    await validator.validateCountryCode(country, mode);
  } catch (err) {
    if (err instanceof DictionaryReferenceError) {
      throw new HttpError(
        409,
        err.code,
        err.code === 'DICTIONARY_ENTRY_INACTIVE'
          ? `Country code ${err.entryCode} is no longer available.`
          : `Country code ${err.entryCode} is not recognised.`,
        [{ path: 'registeredAddress.country', issue: err.code }],
      );
    }
    throw err;
  }
}
