import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventBus } from '@endora-commerce/platform/events';
import { CreditLimitService, type CreditLimitEventBus } from './credit-limit-service.js';

/**
 * `credit_limit.adjusted.v1` announces a write that was committed.
 *
 * Composed with a Command Bus — which is how the module composes itself — the
 * event is the Command's and is dispatched on commit. A service constructed
 * **without** a bus runs the same write in a transaction of its own, and used
 * to emit from inside that transaction's callback: outside an event scope the
 * bus runs subscribers at once, so the adjustment was announced before the
 * commit, and one whose commit then failed had already reached every
 * subscriber — the webhook delivery bridge among them, now that the event is
 * offered to webhooks.
 *
 * The EntityManager here is a stand-in whose `transactional` runs the callback
 * and then commits or refuses, which is the one thing under test.
 */

const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000aa';

function service(commit: 'succeeds' | 'fails') {
  const order: string[] = [];
  const limit = { id: 'limit-1', organizationId: ORGANIZATION_ID, grantedAmount: '1000.00' };
  const tx = {
    findOne: async (entity: { name: string }) => (entity.name === 'CreditLimit' ? limit : null),
    execute: async () => [{ total: 0 }],
    create: (_entity: unknown, data: unknown) => data,
    persist: () => undefined,
  };
  const em = {
    transactional: async <T>(callback: (tx: EntityManager) => Promise<T>): Promise<T> => {
      const result = await callback(tx as unknown as EntityManager);
      if (commit === 'fails') throw new Error('commit refused');
      order.push('commit');
      return result;
    },
  };
  const events = new EventBus();
  const announced: Array<Record<string, unknown>> = [];
  events.on('credit_limit.adjusted.v1', (payload) => {
    order.push('event');
    announced.push(payload as unknown as Record<string, unknown>);
  });
  return {
    subject: new CreditLimitService(() => em as unknown as EntityManager, events as unknown as CreditLimitEventBus),
    announced,
    order,
  };
}

describe('CreditLimitService without a Command Bus — credit_limit.adjusted.v1 follows the commit', () => {
  it('adjust announces the new granted amount once the transaction has committed', async () => {
    const { subject, announced, order } = service('succeeds');
    const result = await subject.adjust({ organizationId: ORGANIZATION_ID, grantedAmount: 2500 });
    expect(result.ok).toBe(true);
    expect(order).toEqual(['commit', 'event']);
    expect(announced).toEqual([
      { eventId: expect.any(String), occurredAt: expect.any(String), organizationId: ORGANIZATION_ID, amount: 2500 },
    ]);
  });

  it('adjust announces nothing when the commit fails', async () => {
    const { subject, announced } = service('fails');
    await expect(subject.adjust({ organizationId: ORGANIZATION_ID, grantedAmount: 2500 })).rejects.toThrow(
      'commit refused',
    );
    expect(announced).toEqual([]);
  });

  it('creditFromReturn announces the new granted amount once the transaction has committed', async () => {
    const { subject, announced, order } = service('succeeds');
    const result = await subject.creditFromReturn({
      organizationId: ORGANIZATION_ID,
      amount: 250.5,
      currency: 'PLN',
      returnCaseId: 'return-1',
    });
    expect(result).toMatchObject({ applied: true, alreadyApplied: false });
    expect(order).toEqual(['commit', 'event']);
    expect(announced).toEqual([
      { eventId: expect.any(String), occurredAt: expect.any(String), organizationId: ORGANIZATION_ID, amount: 1250.5 },
    ]);
  });

  it('creditFromReturn announces nothing when the commit fails', async () => {
    const { subject, announced } = service('fails');
    await expect(
      subject.creditFromReturn({ organizationId: ORGANIZATION_ID, amount: 250.5, currency: 'PLN', returnCaseId: 'return-1' }),
    ).rejects.toThrow('commit refused');
    expect(announced).toEqual([]);
  });
});
