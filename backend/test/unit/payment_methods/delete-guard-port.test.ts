import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { PaymentReadPort } from '@b2b/contracts';
import { makeDeletePaymentMethodCommand } from '../../../src/modules/payment_methods/commands/payment-method.commands.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';
import { HttpError } from '../../../src/http/error-envelope.js';

/**
 * Feature 075 — the delete-guard asks `payments`, it does not read its table.
 *
 * The guard used to run
 * `select count(*) from "payments" where "payment_method_id" = ?` inside this
 * Command. That statement named no import specifier, so the boundary it crossed
 * compiled and returned rows; it is `paymentReadPort.countByPaymentMethod` now,
 * resolved per call so an operator switching `payments` off is seen.
 *
 * The two halves below are the two halves of the manifest's
 * `degrades-without` declaration: the port answers, or it is absent and the
 * delete is refused rather than taken on trust.
 */
describe('payment-method delete-guard (feature 075)', () => {
  const METHOD_ID = randomUUID();

  function method(): PaymentMethod {
    const row = new PaymentMethod();
    row.id = METHOD_ID;
    row.code = 'bank_transfer';
    row.name = { default: 'Bank transfer' };
    row.kind = 'bank_transfer';
    row.adapter = 'bank_transfer';
    row.status = 'active';
    return row;
  }

  function emStub(row: PaymentMethod | null): {
    em: EntityManager;
    removed: () => number;
  } {
    let removedCount = 0;
    const em = {
      findOne: async () => row,
      removeAndFlush: async () => {
        removedCount += 1;
      },
    } as unknown as EntityManager;
    return { em, removed: () => removedCount };
  }

  const actor = {
    actorAdminUserId: null,
    impersonatedCustomerAccountId: null,
    kind: 'system' as const,
  };

  it('deletes when the port reports no attempt against the method', async () => {
    const countByPaymentMethod = vi.fn(async () => 0);
    const port = { countByPaymentMethod } as unknown as PaymentReadPort;
    const { em, removed } = emStub(method());

    const command = makeDeletePaymentMethodCommand(METHOD_ID, { paymentRead: () => port });
    const outcome = await command.run({ em, actor });

    expect(countByPaymentMethod).toHaveBeenCalledWith(METHOD_ID);
    expect(removed()).toBe(1);
    expect(outcome.after).toBeNull();
  });

  it('refuses with 409 when the port reports attempts against the method', async () => {
    const port = {
      countByPaymentMethod: async () => 3,
    } as unknown as PaymentReadPort;
    const { em, removed } = emStub(method());

    const command = makeDeletePaymentMethodCommand(METHOD_ID, { paymentRead: () => port });

    await expect(command.run({ em, actor })).rejects.toMatchObject({ statusCode: 409 });
    expect(removed()).toBe(0);
  });

  /**
   * The degradation the manifest declares. Nothing is caught here: the accessor
   * answers `null` *before* the port is resolved, so a switched-off `payments`
   * and a genuine failure never share one silent no-op — and the operator is
   * told which of the two happened.
   */
  it('refuses the delete while payments is absent, and says why', async () => {
    const { em, removed } = emStub(method());

    const command = makeDeletePaymentMethodCommand(METHOD_ID, { paymentRead: () => null });

    const error = await command.run({ em, actor }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(409);
    expect((error as HttpError).message).toMatch(/payments module is switched off/i);
    expect((error as HttpError).message).toMatch(/inactive/i);
    expect(removed()).toBe(0);
  });

  it('still answers 404 for a method that is not there, without asking the port', async () => {
    const countByPaymentMethod = vi.fn(async () => 0);
    const port = { countByPaymentMethod } as unknown as PaymentReadPort;
    const { em } = emStub(null);

    const command = makeDeletePaymentMethodCommand(METHOD_ID, { paymentRead: () => port });

    await expect(command.run({ em, actor })).rejects.toMatchObject({ statusCode: 404 });
    expect(countByPaymentMethod).not.toHaveBeenCalled();
  });
});
