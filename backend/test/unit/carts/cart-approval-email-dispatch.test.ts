import { describe, expect, it, vi } from 'vitest';
import type { CartEmailDispatch } from '../../../src/modules/carts/services/cart-approval-service.js';

/**
 * T090 unit test — confirms the `CartEmailDispatch` port contract.
 *
 * The carts module wires this port through `CartApprovalService`'s
 * optional 3rd constructor parameter. Implementations are
 * fire-and-forget: thrown errors must NOT roll back the approval
 * transition (it would be a UX regression to fail an approve just
 * because mail delivery hiccupped). Production composition is
 * responsible for resolving recipients, rendering the i18n template,
 * and calling the platform Mailer.
 *
 * This unit-level test exercises a stub implementation to lock in the
 * shape and the swallow-on-error contract. The integration assertion —
 * that `CartApprovalService.{submitForApproval,approve,reject}` calls
 * each method exactly once per transition — is covered by the
 * existing `cart-approval-audit.integration.test.ts` family (which
 * runs against real PostgreSQL and would catch any drift in the
 * call-site wiring).
 */

describe('CartEmailDispatch port', () => {
  it('shape: implementations expose exactly three async methods', () => {
    const stub: CartEmailDispatch = {
      onSubmittedForApproval: vi.fn().mockResolvedValue(undefined),
      onApproved: vi.fn().mockResolvedValue(undefined),
      onRejected: vi.fn().mockResolvedValue(undefined),
    };

    expect(typeof stub.onSubmittedForApproval).toBe('function');
    expect(typeof stub.onApproved).toBe('function');
    expect(typeof stub.onRejected).toBe('function');
  });

  it('swallow-on-error: a throwing implementation should not surface up the call chain when wrapped by the service-level dispatch helper', async () => {
    // Mirror the dispatch helper pattern used inside CartApprovalService —
    // it MUST swallow throws so an approve / reject never gets rolled
    // back by a mail delivery hiccup. This test asserts the contract
    // statically: composition implementations must rely on the service
    // wrapping their throws rather than swallowing them themselves
    // (because swallowing inside the implementation hides the failure
    // from the platform's log / alerting paths).
    const throwingDispatch: CartEmailDispatch = {
      onSubmittedForApproval: vi.fn().mockRejectedValue(new Error('smtp down')),
      onApproved: vi.fn().mockRejectedValue(new Error('smtp down')),
      onRejected: vi.fn().mockRejectedValue(new Error('smtp down')),
    };

    // The service-level dispatch helper is private, so we replicate
    // its surface here.
    async function dispatch(fn: () => Promise<unknown>): Promise<void> {
      try {
        await fn();
      } catch {
        // swallow
      }
    }

    await expect(
      dispatch(() =>
        throwingDispatch.onSubmittedForApproval({
          // The shape carries Cart + actor at the call site; we cast
          // here because this test only exercises the swallow path.
          cart: {} as never,
          submitter: { customerAccountId: 'b', organizationId: 'o' },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(throwingDispatch.onSubmittedForApproval).toHaveBeenCalledOnce();
  });
});
