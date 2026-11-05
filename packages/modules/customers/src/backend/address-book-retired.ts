import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * The refusal every former personal-address-book endpoint answers with
 * (`specs/173-b2c-address-book-merge/` release 1, OD-5 / OD-8): `410 Gone`,
 * `CUSTOMER_ADDRESS_BOOK_RETIRED`, for every caller. The envelope translates
 * the sentence from this module's bundle (`errors.CUSTOMER_ADDRESS_BOOK_RETIRED`);
 * the English one here is the untranslated fallback. Release 2 deletes this
 * file with the routes that raise it.
 */
export function addressBookRetired(): never {
  throw new HttpError(
    410,
    ERROR_CODES.CUSTOMER_ADDRESS_BOOK_RETIRED,
    "The personal address book has been retired. Addresses are kept in your organization's address book.",
  );
}
