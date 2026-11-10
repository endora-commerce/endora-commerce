import { expect } from 'vitest';
import { ERROR_CODES, LINE_QUANTITY_MAX, REQUEST_LINE_ITEMS_MAX } from '@endora-commerce/contracts';

/**
 * Issue #351 — the assertions every route family's line-bound contract test
 * shares: a request past a bound is a refusal naming the field, never a
 * database error.
 */

export { LINE_QUANTITY_MAX, REQUEST_LINE_ITEMS_MAX };

interface InjectReply {
  statusCode: number;
  body: string;
  json(): unknown;
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/**
 * A line quantity past `LINE_QUANTITY_MAX` (architect ruling R1). On a route
 * that validates through its schema it is `400 LINE_QUANTITY_EXCEEDED`, the
 * translated code, with the one `details` entry naming the field. The external
 * namespace (`external: true`) parses its body itself and answers every shape
 * error `422 VALIDATION_FAILED`, as it does for the money-precision issue; the
 * entry there carries the code as its `issue`.
 */
export function expectQuantityRefused(res: InjectReply, path: string, options: { external?: boolean } = {}): void {
  const body = res.json() as ErrorBody;
  if (options.external) {
    expect(res.statusCode, res.body).toBe(422);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  } else {
    expect(res.statusCode, res.body).toBe(400);
    expect(body.error.code).toBe(ERROR_CODES.LINE_QUANTITY_EXCEEDED);
  }
  expect(body.error.details).toEqual([{ path, issue: ERROR_CODES.LINE_QUANTITY_EXCEEDED }]);
}

/** A line array past `REQUEST_LINE_ITEMS_MAX` on a schema-bounded route: `400 VALIDATION_FAILED` naming the array (ruling R2). */
export function expectLineCountRefused(res: InjectReply, path: string): void {
  expect(res.statusCode, res.body).toBe(400);
  const body = res.json() as ErrorBody & { error: { details?: Array<{ path: string }> } };
  expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  expect(body.error.details?.map((d) => d.path)).toContain(path);
}

/**
 * A request valid on its own whose line would end past the bound — a merge, or
 * a packaging unit's pieces (ruling R3): `422 LINE_QUANTITY_EXCEEDED` with the
 * resulting quantity and the bound.
 */
export function expectMergeRefused(res: InjectReply, quantity: number): void {
  expect(res.statusCode, res.body).toBe(422);
  const body = res.json() as ErrorBody;
  expect(body.error.code).toBe(ERROR_CODES.LINE_QUANTITY_EXCEEDED);
  expect(body.error.details).toEqual({ quantity, maximum: LINE_QUANTITY_MAX });
}
