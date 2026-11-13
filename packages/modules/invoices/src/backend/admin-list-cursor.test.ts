import { describe, expect, it } from 'vitest';
import { HttpError } from '@endora-commerce/platform/http';
import { afterPosition, decodeInvoiceListCursor, encodeInvoiceListCursor } from './admin-list-cursor.js';

/**
 * Issue #1120 — the admin invoice list's cursor names the last row of a page
 * by its sort key, `(issuedAt desc, id desc)`. It is opaque to a client and
 * refused when it is not one this route issued.
 */
describe('admin invoice list cursor (issue #1120)', () => {
  const position = { issuedAt: new Date('2026-11-13T12:00:00.000Z'), id: '7f3c1f52-1a2b-4c3d-8e9f-0a1b2c3d4e5f' };

  it('round-trips a position', () => {
    expect(decodeInvoiceListCursor(encodeInvoiceListCursor(position))).toEqual(position);
  });

  it('is base64url, not the key in the clear', () => {
    const cursor = encodeInvoiceListCursor(position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain(position.id);
  });

  it.each(['not-a-cursor', '', Buffer.from('2026-11-13T12:00:00.000Z|nope').toString('base64url'), Buffer.from('nope|7f3c1f52-1a2b-4c3d-8e9f-0a1b2c3d4e5f').toString('base64url')])(
    'refuses %j with a 400 VALIDATION_FAILED',
    (raw) => {
      let thrown: unknown;
      try {
        decodeInvoiceListCursor(raw);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HttpError);
      expect((thrown as HttpError).statusCode).toBe(400);
      expect((thrown as HttpError).code).toBe('VALIDATION_FAILED');
    },
  );

  it('reads the rows strictly after a position in (issuedAt desc, id desc) order', () => {
    expect(afterPosition(position)).toEqual({
      $or: [{ issuedAt: { $lt: position.issuedAt } }, { issuedAt: position.issuedAt, id: { $lt: position.id } }],
    });
  });
});
