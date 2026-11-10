/**
 * The audit-state rule for credit limits (`specs/conventions/audit-state.md`,
 * D-288, issue #470). A credit limit is `@OrgScoped`, so its audit entries
 * carry names and structure, never the amounts or the Organization they belong
 * to: `changedFields: ['grantedAmount']`, not the amount. No credit-limit
 * screen reads values back from the audit log, so there is no value store.
 *
 * Each Command runs through the **real** `CommandBus` with a recording audit
 * port; the EntityManager is an in-memory stand-in.
 */
import { AssertionError } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus } from '@endora-commerce/platform/events';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { CreditLimitService, type CreditLimitEventBus } from './credit-limit-service.js';

// A local copy of `expectNoAuditValues` from `@endora-commerce/test-kit/audit`
// (#1004); replace with the import once #1004 has merged.
function expectNoAuditValues(entries: readonly RecordAuditInput[], sentinels: readonly string[]): void {
  if (entries.length === 0) throw new AssertionError({ message: 'no audit entry to inspect' });
  const leaks: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined) return;
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) walk(child, `${path}.${key}`);
      return;
    }
    for (const sentinel of sentinels) if (String(value).includes(sentinel)) leaks.push(`${path} = ${JSON.stringify(value)}`);
  };
  entries.forEach((entry, index) => {
    walk(entry.stateBefore, `[${index}] ${entry.action} stateBefore`);
    walk(entry.stateAfter, `[${index}] ${entry.action} stateAfter`);
  });
  if (leaks.length > 0) throw new AssertionError({ message: `the audit log carries tenant-scoped values:\n  ${leaks.join('\n  ')}` });
}

const ADMIN = '00000000-0000-4000-8000-0000000004a1';
const ORG = randomUUID();
const RETURN_CASE = '00000000-0000-4000-8000-0000000004c1';
const SENTINELS = [ORG, '470470', '470471', '4704.70'];

function harness() {
  const limit = { id: 'limit-1', organizationId: ORG, grantedAmount: '470470.00', currency: 'PLN' };
  const tx = {
    findOne: async (entity: { name: string }) => (entity.name === 'CreditLimit' ? limit : null),
    execute: async () => [{ total: 0 }],
    create: (_entity: unknown, data: Record<string, unknown>) => ({ id: 'limit-new', ...data }),
    persist: () => undefined,
  };
  const em = { fork: () => em, transactional: async <T>(fn: (scoped: unknown) => Promise<T>) => fn(tx) };
  const entries: RecordAuditInput[] = [];
  const audit = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
  };
  const events = new EventBus();
  const bus = new CommandBus({ em } as never, audit as never, events);
  const service = new CreditLimitService(() => em as never, events as unknown as CreditLimitEventBus, bus);
  const asAdmin = <T>(fn: () => Promise<T>) => withSystemScopeActingFor(ADMIN, 'credit limit sentinel test', fn);
  return { service, entries, asAdmin };
}

describe('credit-limit audit state carries names, never values (#470)', () => {
  it('credit_limit.grant names the amount and the currency, holds neither nor the Organization', async () => {
    const h = harness();
    await h.asAdmin(() => h.service.grant({ organizationId: ORG, grantedAmount: 470471, currency: 'PLN' }));
    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.stateAfter).toEqual({ changedFields: ['currency', 'grantedAmount'] });
  });

  it('credit_limit.adjust names the amount it changed', async () => {
    const h = harness();
    await h.asAdmin(() => h.service.adjust({ organizationId: ORG, grantedAmount: 470471 }));
    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.stateAfter).toEqual({ changedFields: ['grantedAmount'] });
  });

  it('credit_limit.credit_from_return names the amount and keeps which return case', async () => {
    const h = harness();
    await h.asAdmin(() =>
      h.service.creditFromReturn({ organizationId: ORG, amount: 4704.7, currency: 'PLN', returnCaseId: RETURN_CASE }),
    );
    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.stateAfter).toEqual({ changedFields: ['grantedAmount'], returnCaseId: RETURN_CASE });
  });
});
