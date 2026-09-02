import { describe, expect, it } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { OrderConfirmationService } from '../../../../packages/modules/orders/src/backend/services/order-confirmation-service.js';

/**
 * The additional confirmation recipients do not silently become none when
 * `organizations` is absent (the promise half of issue #84).
 *
 * `check:port-catches` read the `try`/`catch` statement and nothing else, so
 * `this.orgPort.getConfirmationEmails(id).catch(() => [])` was outside its
 * population. This one is live rather than latent: the port is reached through
 * an `async` arrow in `orders`' plugin, so the gate arrives here as a
 * **rejection** and the `.catch` absorbed it — an order confirmation that
 * quietly went to the buyer alone.
 *
 * Two assertions per case on purpose: the presence answer reaches the caller,
 * **and** an ordinary failure is still tolerated. FR-015 says an unreadable
 * recipient list is never fatal, and a "delete the catch" repair would fail the
 * second.
 */
describe('OrderConfirmationService.resolveAdditional', () => {
  it('lets a ModuleDisabledError through instead of reporting no recipients', async () => {
    const service = new OrderConfirmationService({
      getConfirmationEmails: () => Promise.reject(new ModuleDisabledError('organizations')),
    });
    await expect(service.resolveAdditional('org-1', 'channel-1')).rejects.toBeInstanceOf(
      ModuleDisabledError,
    );
  });

  it('still tolerates an ordinary failure of the same read', async () => {
    const service = new OrderConfirmationService({
      getConfirmationEmails: () => Promise.reject(new Error('the organization read failed')),
    });
    await expect(service.resolveAdditional('org-1', 'channel-1')).resolves.toEqual([]);
  });

  it('still drops invalid and duplicate addresses', async () => {
    const service = new OrderConfirmationService({
      getConfirmationEmails: () => Promise.resolve(['ops@example.com', 'nope', 'OPS@example.com']),
    });
    await expect(service.resolveAdditional('org-1', 'channel-1')).resolves.toEqual([
      'ops@example.com',
    ]);
  });
});
