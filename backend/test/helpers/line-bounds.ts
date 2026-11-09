import { expect } from 'vitest';
import { ERROR_CODES, LINE_QUANTITY_MAX, REQUEST_LINE_ITEMS_MAX } from '@endora-commerce/contracts';

/**
 * Issue #351 — the assertions every route family's line-bound contract test
 * shares: a request one past a bound is a validation failure naming the field,
 * never a database error.
 */

export { LINE_QUANTITY_MAX, REQUEST_LINE_ITEMS_MAX };

interface InjectReply {
  statusCode: number;
  body: string;
  json(): unknown;
}

interface ValidationBody {
  error: { code: string; details?: Array<{ path: string; issue: string }> };
}

/**
 * `status VALIDATION_FAILED`, with a detail whose path is `path`. `status` is
 * `400` on every route that validates through its route schema and `422` on the
 * external namespace, whose handlers parse the body themselves.
 */
export function expectBoundRefused(res: InjectReply, path: string, status: 400 | 422 = 400): void {
  expect(res.statusCode, res.body).toBe(status);
  const body = res.json() as ValidationBody;
  expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  expect(body.error.details?.map((d) => d.path)).toContain(path);
}
