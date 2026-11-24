/**
 * The audit-state rule for default ordering preferences (`specs/conventions/audit-state.md`
 * §5, D-288, issue #470). A `QuickOrderDefaultPreference` row is `@GlobalEntity`, but each
 * one is **about** a tenant-scoped record — an Organization or a customer account, named by
 * `scopeId` — so its writes follow the rule: the entry carries the scope (a code), the ids
 * of the chosen methods and addresses (opaque references) and the names of the fields that
 * changed, never the Organization or the account it belongs to (the tenant anchor). It is
 * recorded against the preference row by id.
 *
 * The service runs against an in-memory EntityManager and stub ports; the audit port
 * records what it is handed.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort, RecordAuditInput } from '@endora-commerce/platform/kernel';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import { QUICK_ORDER_AUDIT_KEYS } from './default-preference-audit-state.js';
import { DefaultPreferenceService, type DefaultPreferenceCollaborators } from './default-preference-service.js';

const ORG = randomUUID();
const CUSTOMER = randomUUID();
const ADDRESS = randomUUID();
const PAYMENT = randomUUID();

function harness(stored: Record<string, unknown> | null) {
  const entries: RecordAuditInput[] = [];
  let row = stored;
  const em = {
    findOne: async () => row,
    create: (_entity: unknown, data: Record<string, unknown>) => {
      row = { id: randomUUID(), ...data };
      return row;
    },
    persist: () => ({ flush: async () => undefined }),
  };
  const audit = {
    record: async (input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return {} as never;
    },
  } as unknown as AuditPort;
  const ports = {
    customerAccounts: { findById: async () => ({ id: CUSTOMER, organizationId: ORG }) },
    addresses: { findById: async () => ({ id: ADDRESS, organizationId: ORG, deletedAt: null }) },
  } as unknown as DefaultPreferenceCollaborators;
  const service = new DefaultPreferenceService(() => em as unknown as EntityManager, audit, ports);
  return { service, entries };
}

function expectKeysAllowlisted(entries: readonly RecordAuditInput[]): void {
  for (const entry of entries) {
    for (const state of [entry.stateBefore, entry.stateAfter]) {
      for (const key of Object.keys(state ?? {})) expect(QUICK_ORDER_AUDIT_KEYS, `${entry.action}: ${key}`).toContain(key);
    }
  }
}

const ADMIN = { kind: 'platform_admin', adminUserId: randomUUID() } as const;

describe('default ordering preference audit state names no tenant (#470)', () => {
  it('an Organization-scoped first write names the fields it set, never the Organization', async () => {
    const h = harness(null);

    await h.service.upsert(ADMIN as never, { scope: 'organization', scopeId: ORG, defaultBillingAddressId: ADDRESS }, {});

    expectNoAuditValues(h.entries, [ORG]);
    expectKeysAllowlisted(h.entries);
    expect(h.entries.map((e) => e.action)).toEqual(['quick_order.default_preference.update']);
    expect(h.entries[0]?.stateBefore).toBeNull();
    expect(h.entries[0]?.stateAfter).toEqual({
      scope: 'organization',
      defaultPaymentMethodId: null,
      defaultDeliveryMethodId: null,
      defaultBillingAddressId: ADDRESS,
      defaultShippingAddressId: null,
      changedFields: ['defaultBillingAddressId'],
    });
  });

  it('a customer-scoped change names what changed, never the customer account', async () => {
    const h = harness({
      id: randomUUID(),
      scope: 'customer',
      scopeId: CUSTOMER,
      defaultPaymentMethodId: null,
      defaultDeliveryMethodId: null,
      defaultBillingAddressId: ADDRESS,
      defaultShippingAddressId: null,
    });

    await h.service.upsert(
      ADMIN as never,
      { scope: 'customer', scopeId: CUSTOMER, defaultPaymentMethodId: PAYMENT, defaultBillingAddressId: ADDRESS },
      {},
    );

    expectNoAuditValues(h.entries, [CUSTOMER, ORG]);
    expectKeysAllowlisted(h.entries);
    expect(h.entries[0]?.stateBefore).toMatchObject({ scope: 'customer', defaultPaymentMethodId: null });
    expect(h.entries[0]?.stateAfter).toMatchObject({
      scope: 'customer',
      defaultPaymentMethodId: PAYMENT,
      changedFields: ['defaultPaymentMethodId'],
    });
  });
});
