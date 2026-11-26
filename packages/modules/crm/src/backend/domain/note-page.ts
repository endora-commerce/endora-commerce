import { isUuidShape } from '@endora-commerce/contracts';

/**
 * The page arithmetic of `opportunityReadPort.listNotes` (issue #1905).
 *
 * Notes are walked oldest first by `(created_at, id)`, and a page ends with a
 * **keyset cursor** naming its last note: the next page starts strictly after
 * it, so a note written during a long walk lands at its end instead of
 * shifting every page after it, as an offset would. The instant is carried as
 * text at the database's full precision — a `Date` would drop the
 * microseconds a stored instant may carry, and the walk would repeat a note.
 *
 * Pure: the service reads the key out of its statement, and refuses what
 * {@link noteListBounds} answers `null` for.
 */

/** The `(created_at, id)` of the last note of a page. */
export interface NoteCursorKey {
  /** UTC, `YYYY-MM-DDTHH:MM:SS.ffffffZ` — what {@link NOTE_CURSOR_INSTANT_SQL} renders. */
  readonly createdAt: string;
  readonly id: string;
}

/**
 * The SQL that renders `created_at` of a comment aliased `c` as a cursor's
 * instant: UTC, six fractional digits, whatever the session's time zone.
 */
export const NOTE_CURSOR_INSTANT_SQL = `to_char(c."created_at" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeNoteCursor(key: NoteCursorKey): string {
  return Buffer.from(JSON.stringify([key.createdAt, key.id]), 'utf8').toString('base64url');
}

/** The key a cursor this port issued names; `null` for anything else. */
export function decodeNoteCursor(cursor: string): NoteCursorKey | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [createdAt, id] = parsed as unknown[];
  if (typeof createdAt !== 'string' || !INSTANT.test(createdAt)) return null;
  if (typeof id !== 'string' || !isUuidShape(id)) return null;
  return { createdAt, id };
}

/** What a notes query asks, as far as the page goes. */
export interface NoteListQueryBounds {
  limit: number;
  createdFrom?: Date | undefined;
  createdBefore?: Date | undefined;
  cursor?: string | null | undefined;
}

export interface NoteListBounds {
  /** Whole, between 0 and the port's maximum. */
  limit: number;
  createdFrom: Date | null;
  createdBefore: Date | null;
  after: NoteCursorKey | null;
}

/**
 * The query held to its bounds: the limit clamped to `[0, max]`, the range
 * and the cursor read. `null` for an invalid `Date` or a cursor this port did
 * not issue — a refusal, never a silent first page, which would restart a
 * caller's walk without telling it.
 */
export function noteListBounds(query: NoteListQueryBounds, max: number): NoteListBounds | null {
  const createdFrom = query.createdFrom ?? null;
  const createdBefore = query.createdBefore ?? null;
  if (createdFrom !== null && Number.isNaN(createdFrom.getTime())) return null;
  if (createdBefore !== null && Number.isNaN(createdBefore.getTime())) return null;
  let after: NoteCursorKey | null = null;
  if (query.cursor !== undefined && query.cursor !== null) {
    after = decodeNoteCursor(query.cursor);
    if (after === null) return null;
  }
  const limit = Number.isFinite(query.limit) ? Math.min(Math.max(0, Math.trunc(query.limit)), max) : 0;
  return { limit, createdFrom, createdBefore, after };
}
