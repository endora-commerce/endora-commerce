import { describe, expect, it } from 'vitest';
import { decodeNoteCursor, encodeNoteCursor, noteListBounds } from './note-page.js';

const ID = '00000000-0000-4000-8000-0000000000a1';
const AT = '2026-03-01T09:00:00.123456Z';

/**
 * The page arithmetic of `opportunityReadPort.listNotes` (issue #1905): a
 * keyset cursor over `(created_at, id)` the port issues and reads back, and the
 * bounds a query is held to before any statement runs.
 */
describe('the notes cursor', () => {
  it('reads back the key it was made from, at full precision', () => {
    expect(decodeNoteCursor(encodeNoteCursor({ createdAt: AT, id: ID }))).toEqual({ createdAt: AT, id: ID });
  });

  it('is opaque and URL-safe', () => {
    expect(encodeNoteCursor({ createdAt: AT, id: ID })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('refuses a cursor it did not issue', () => {
    const forge = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const cursor of [
      '',
      'forged',
      forge([AT]),
      forge([AT, 'not-an-id']),
      forge(['yesterday', ID]),
      forge(['2026-03-01 09:00:00+00', ID]),
      forge({ createdAt: AT, id: ID }),
      forge([AT, ID, 'extra']),
    ]) {
      expect(decodeNoteCursor(cursor), cursor).toBeNull();
    }
  });
});

describe('the bounds of a notes query', () => {
  it('holds the limit between 0 and the maximum, whole', () => {
    expect(noteListBounds({ limit: 10 }, 100)).toMatchObject({ limit: 10 });
    expect(noteListBounds({ limit: 10_000 }, 100)).toMatchObject({ limit: 100 });
    expect(noteListBounds({ limit: -3 }, 100)).toMatchObject({ limit: 0 });
    expect(noteListBounds({ limit: 2.9 }, 100)).toMatchObject({ limit: 2 });
    expect(noteListBounds({ limit: Number.NaN }, 100)).toMatchObject({ limit: 0 });
  });

  it('carries the range and the cursor key, and no filter it was not given', () => {
    const from = new Date('2026-03-01T00:00:00.000Z');
    const before = new Date('2026-04-01T00:00:00.000Z');
    const cursor = encodeNoteCursor({ createdAt: AT, id: ID });
    expect(noteListBounds({ limit: 5, createdFrom: from, createdBefore: before, cursor }, 100)).toEqual({
      limit: 5,
      createdFrom: from,
      createdBefore: before,
      after: { createdAt: AT, id: ID },
    });
    expect(noteListBounds({ limit: 5, cursor: null }, 100)).toEqual({
      limit: 5,
      createdFrom: null,
      createdBefore: null,
      after: null,
    });
  });

  it('answers null for an invalid instant or a forged cursor', () => {
    expect(noteListBounds({ limit: 5, createdFrom: new Date('nope') }, 100)).toBeNull();
    expect(noteListBounds({ limit: 5, createdBefore: new Date('nope') }, 100)).toBeNull();
    expect(noteListBounds({ limit: 5, cursor: 'forged' }, 100)).toBeNull();
  });
});
