import { describe, expect, it } from 'vitest';
import { BankTransferDriver } from '../../../../packages/modules/payments/src/backend/drivers/bank-transfer-driver.js';
import { PickupDriver } from '../../../../packages/modules/payments/src/backend/drivers/pickup-driver.js';
import { GatewayAdapterPortNotWired } from '../../../../packages/modules/payments/src/backend/drivers/gateway-adapter-port.js';

/**
 * T139 / T140 / T141 — driver contracts. The drivers are pure-data today;
 * the order-service refactor that dispatches through them is a separate
 * slice.
 */

describe('BankTransferDriver', () => {
  it('emits an awaiting_transfer next action with a derived reference', () => {
    const result = new BankTransferDriver().reserve({
      orderId: '11111111-2222-3333-4444-555555555555',
      iban: 'PL00000000000000000000000000',
    });
    expect(result.paymentRef).toBeNull();
    expect(result.nextAction.kind).toBe('awaiting_transfer');
    if (result.nextAction.kind === 'awaiting_transfer') {
      expect(result.nextAction.iban).toBe('PL00000000000000000000000000');
      expect(result.nextAction.reference).toBe('ORDER-11111111');
    }
  });
});

describe('PickupDriver', () => {
  it('returns next action kind=none', () => {
    const result = new PickupDriver().reserve();
    expect(result.paymentRef).toBeNull();
    expect(result.nextAction).toEqual({ kind: 'none' });
  });
});

describe('GatewayAdapterPortNotWired', () => {
  it('throws 501 NOT_IMPLEMENTED on reserve()', async () => {
    const port = new GatewayAdapterPortNotWired();
    await expect(
      port.reserve({
        orderId: 'o-1',
        organizationId: 'o-2',
        amount: 1,
        currency: 'PLN',
        vendorConfig: {},
        tx: {} as never,
      }),
    ).rejects.toThrow(/No payment-gateway adapter is configured/);
  });

  it('throws 501 on settle() too', async () => {
    const port = new GatewayAdapterPortNotWired();
    await expect(
      port.settle({
        orderId: 'o-1',
        paymentRef: 'r-1',
        vendorConfig: {},
        tx: {} as never,
      }),
    ).rejects.toThrow(/No payment-gateway adapter is configured/);
  });
});
