import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import { HttpError, decodeCursor, encodeCursor } from '@endora-commerce/platform/http';
import type { AuditLogPosition } from '@endora-commerce/platform/kernel';

/**
 * The cursor of `GET /api/v1/admin/audit-log` (issue #1555): the sort key of
 * the last entry a page answered, `(actedAt desc, id desc)`, the order the
 * platform's audit read pages in. The encoding is the platform's, so the value
 * is opaque base64url like every other list cursor; a client passes it back as
 * `?cursor=` and reads nothing out of it. The invoices list's cursor
 * (`invoices/src/backend/admin-list-cursor.ts`) is the precedent.
 */

const SEPARATOR = '|';

export function encodeAuditLogCursor(position: AuditLogPosition): string {
  return encodeCursor(`${position.actedAt.toISOString()}${SEPARATOR}${position.id}`);
}

/** The position a cursor names; a value this route did not issue is a 400. */
export function decodeAuditLogCursor(raw: string): AuditLogPosition {
  const key = decodeCursor(raw);
  const at = key?.indexOf(SEPARATOR) ?? -1;
  if (key !== undefined && at > 0) {
    const actedAt = new Date(key.slice(0, at));
    const id = key.slice(at + 1);
    if (!Number.isNaN(actedAt.getTime()) && isUuidShape(id)) return { actedAt, id };
  }
  throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The cursor is not one this API issued.', [
    { path: 'cursor', issue: 'Expected a cursor from a previous page' },
  ]);
}
