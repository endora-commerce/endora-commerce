import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrderReturnContextPort } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { ReturnSettlementService, type ReturnSettlementServiceDeps } from './return-settlement-service.js';

/**
 * Issue #875 (architect's ruling on PR #937, item 5): the settlement recomputes
 * the default from the order, so an order it cannot read is refused — `404`,
 * before any effect and with nothing written — never settled on the figures
 * stored at creation. A switched-off `orders` still answers `503`.
 */
const CASE_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const ITEM_ID = 'aaaaaaaa-0000-4000-8000-000000000002';

function harness(getReturnContext: OrderReturnContextPort['getReturnContext']) {
  const rc = {
    id: CASE_ID,
    kind: 'return',
    orderId: 'aaaaaaaa-0000-4000-8000-000000000003',
    statusCode: 'received',
    resolutionType: null,
    currency: 'PLN',
    organizationId: 'aaaaaaaa-0000-4000-8000-000000000004',
  };
  const item = {
    id: ITEM_ID,
    returnCaseId: CASE_ID,
    orderItemId: 'aaaaaaaa-0000-4000-8000-000000000005',
    productName: 'Bolt',
    quantity: 1,
    defaultRefundAmount: '12.32',
    defaultDiscountAmount: '0.00',
    approvedRefundAmount: '12.32',
  };
  const em = {
    findOne: vi.fn(async () => rc),
    find: vi.fn(async () => [item]),
    getKnex: () => ({ transaction: async <T>(work: (lock: { raw: () => Promise<void> }) => Promise<T>) => work({ raw: async () => {} }) }),
    flush: vi.fn(),
    persist: vi.fn(),
  };
  const deps = {
    emFactory: () => em as unknown as EntityManager,
    events: { emit: vi.fn() },
    transitions: { apply: vi.fn() },
    graphService: { loadGraph: vi.fn(async () => ({ canTransition: () => true })) },
    paymentRefund: { refund: vi.fn() },
    correctiveInvoice: { validateCorrection: vi.fn(), createCorrection: vi.fn() },
    creditTopup: { creditFromReturn: vi.fn() },
    orderContext: { getReturnContext: vi.fn(getReturnContext) },
    auditLog: { recordWithin: vi.fn() },
  };
  const service = new ReturnSettlementService(deps as unknown as ReturnSettlementServiceDeps);
  const nothingHappened = () => {
    expect(deps.paymentRefund.refund).not.toHaveBeenCalled();
    expect(deps.creditTopup.creditFromReturn).not.toHaveBeenCalled();
    expect(deps.correctiveInvoice.validateCorrection).not.toHaveBeenCalled();
    expect(deps.correctiveInvoice.createCorrection).not.toHaveBeenCalled();
    expect(deps.transitions.apply).not.toHaveBeenCalled();
    expect(deps.auditLog.recordWithin).not.toHaveBeenCalled();
    expect(em.flush).not.toHaveBeenCalled();
    expect(em.persist).not.toHaveBeenCalled();
  };
  return { service, nothingHappened };
}

const request = {
  resolutionType: 'refund' as const,
  refundPaymentMethodId: 'aaaaaaaa-0000-4000-8000-000000000006',
  lines: [{ returnCaseItemId: ITEM_ID, approvedRefundAmount: 12.32 }],
};

describe('ReturnSettlementService — an order it cannot read (#875)', () => {
  it('refuses with 404 and makes no gateway, credit or correction call, and writes nothing', async () => {
    const { service, nothingHappened } = harness(async () => null);
    await expect(service.settle(CASE_ID, 'admin', request)).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    nothingHappened();
  });

  it('lets a switched-off orders module answer 503, uncaught', async () => {
    const { service, nothingHappened } = harness(async () => {
      throw new ModuleDisabledError('orders');
    });
    await expect(service.settle(CASE_ID, 'admin', request)).rejects.toBeInstanceOf(ModuleDisabledError);
    nothingHappened();
  });

  it('keeps showing the stored figures in the prefill', async () => {
    const { service } = harness(async () => null);
    const prefill = await service.getPrefill(CASE_ID);
    expect(prefill.items).toEqual([expect.objectContaining({ defaultRefundAmount: 12.32, approvedRefundAmount: 12.32 })]);
  });
});
