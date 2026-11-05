import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #753 — a `:id` that is not a UUID names no record. It used to reach
 * PostgreSQL unchecked, which raised `invalid input syntax for type uuid` and
 * answered 500; it answers the route's own not-found, exactly as a well-formed
 * id that names nothing does.
 */

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };
const UNKNOWN_ID = '00000000-0000-4000-8000-00000000f753';

type ErrorBody = { error: { code: string; message: string; requestId?: string } };
const answerOf = (body: unknown) => {
  const { code, message } = (body as ErrorBody).error;
  return { code, message };
};

describe('GET /api/v1/organization/carts/:id — a malformed id (issue #753)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const get = (id: string) =>
    h.app.inject({ method: 'GET', url: `/api/v1/organization/carts/${encodeURIComponent(id)}`, cookies: CUSTOMER, headers: CHANNEL });

  it.each(['1c0785cf', 'not-a-uuid', '00000000-0000-4000-8000-00000000075z'])(
    'answers 404, not 500, for %s',
    async (id) => {
      const res = await get(id);
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
    },
  );

  it('answers a malformed id as it answers a well-formed id that names nothing', async () => {
    const unknown = await get(UNKNOWN_ID);
    const malformed = await get('1c0785cf');
    expect(unknown.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(unknown.statusCode);
    // The request id is per request; the code and the message are the answer.
    expect(answerOf(malformed.json())).toEqual(answerOf(unknown.json()));
  });
});
