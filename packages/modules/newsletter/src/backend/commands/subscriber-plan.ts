import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * A subscriber write whose audit `objectId` and action are fixed before the
 * Command runs (issue #1381) found, inside its transaction, a row that is not
 * the one it was planned against — another request created or deleted the
 * subscriber in between. The write stops rather than recording an entry that
 * names the wrong row.
 */
export function subscriberPlanConflict(): HttpError {
  return new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Subscriber was modified.');
}
