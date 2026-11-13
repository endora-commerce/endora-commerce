import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import { HttpError, decodeCursor, encodeCursor } from '@endora-commerce/platform/http';

/**
 * The cursor of `GET /api/v1/admin/invoices` (issue #1120): the sort key of the
 * last row a page answered, `(issuedAt desc, id desc)`. The id breaks a tie on
 * `issuedAt`, without which two invoices issued in the same millisecond would
 * be skipped or repeated across a page boundary.
 *
 * The encoding is the platform's (`encodeCursor` / `decodeCursor`), so the
 * value is opaque base64url like every other list cursor; a client passes it
 * back as `?cursor=` and reads nothing out of it.
 */
export interface InvoiceListPosition {
  readonly issuedAt: Date;
  readonly id: string;
}

const SEPARATOR = '|';

export function encodeInvoiceListCursor(position: InvoiceListPosition): string {
  return encodeCursor(`${position.issuedAt.toISOString()}${SEPARATOR}${position.id}`);
}

/** The position a cursor names; a value this route did not issue is a 400. */
export function decodeInvoiceListCursor(raw: string): InvoiceListPosition {
  const key = decodeCursor(raw);
  const at = key?.indexOf(SEPARATOR) ?? -1;
  if (key !== undefined && at > 0) {
    const issuedAt = new Date(key.slice(0, at));
    const id = key.slice(at + 1);
    if (!Number.isNaN(issuedAt.getTime()) && isUuidShape(id)) return { issuedAt, id };
  }
  throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The cursor is not one this API issued.', [
    { path: 'cursor', issue: 'Expected a cursor from a previous page' },
  ]);
}

/** The rows strictly after `position` in `(issuedAt desc, id desc)` order. */
export function afterPosition(position: InvoiceListPosition): Record<string, unknown> {
  return {
    $or: [{ issuedAt: { $lt: position.issuedAt } }, { issuedAt: position.issuedAt, id: { $lt: position.id } }],
  };
}
