import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, NOTIFY_REQUIRES_CUSTOMER_VISIBLE } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from '../../integration/returns/helpers.js';

/**
 * `specs/180-off-platform-complaints/` T023, contracts/admin-api.md §A1 (FR-A21):
 * `POST /api/v1/admin/returns/:id/comments` refuses `notifyCustomer` on an internal
 * comment with 422 `VALIDATION_FAILED`, detail `code: notify_requires_customer_visible`,
 * and accepts the three other combinations unchanged.
 */
describe('POST /api/v1/admin/returns/:id/comments — notify requires a customer-visible comment', () => {
  let h: BackendServerHandle;
  let caseId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'complaint', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    caseId = (res.json() as { data: { id: string } }).data.id;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const post = (payload: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${caseId}/comments`, cookies: ADMIN_COOKIE, payload });

  it('answers 422 VALIDATION_FAILED with the detail code', async () => {
    const res = await post({ body: 'internal', isCustomerVisible: false, notifyCustomer: true });
    expect(res.statusCode).toBe(422);
    const error = (res.json() as { error: { code: string; details: { code: string } } }).error;
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.details.code).toBe(NOTIFY_REQUIRES_CUSTOMER_VISIBLE);
  });

  it.each([
    [true, true],
    [true, false],
    [false, false],
  ])('accepts isCustomerVisible=%s, notifyCustomer=%s with 201', async (isCustomerVisible, notifyCustomer) => {
    const res = await post({ body: 'a message', isCustomerVisible, notifyCustomer });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { data: { isCustomerVisible: boolean } }).data.isCustomerVisible).toBe(isCustomerVisible);
  });

  it('still answers 400 for a body that is missing a flag', async () => {
    const res = await post({ body: 'a message', isCustomerVisible: true });
    expect(res.statusCode).toBe(400);
  });
});
