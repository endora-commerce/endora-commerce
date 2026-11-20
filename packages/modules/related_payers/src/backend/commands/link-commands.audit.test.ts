/**
 * The audit-state rule for payer links (`specs/conventions/audit-state.md`, D-288;
 * `specs/182-related-payers/contracts/commands-audit.md`). A `RelatedPayerLink` is
 * `@OrgScoped` on the buyer, so the four link Commands record ids, codes, dates and
 * booleans — never the payer's name, tax ID, address or e-mail, and never the buyer anchor.
 *
 * Each Command runs through the **real** `CommandBus` with a recording audit port; the
 * EntityManager is an in-memory stand-in. What is under test is what the Command hands the bus.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AddressRecord, OrganizationRecord } from '@endora-commerce/contracts';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus } from '@endora-commerce/platform/events';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import { RELATED_PAYERS_AUDIT_KEYS } from './audit-state.js';
import { LinkWriteService } from '../services/link-write-service.js';

const ADMIN = '00000000-0000-4000-8000-0000000004a1';
const BUYER = randomUUID();
const PAYER = randomUUID();
const ADDRESS = randomUUID();
const SENTINELS = [BUYER, 'S182-NAME', 'S182TAXID99', 'S182-STREET', 's182@example.test', 'S182-BUYER-NAME'];

function organization(id: string, name: string): OrganizationRecord {
  return {
    id,
    name,
    legalName: name,
    taxId: 'S182TAXID99',
    status: 'active',
    vatStatus: 'vat_payer',
    isPersonal: false,
    customerGroupId: null,
    registeredAddress: { street: 'S182-STREET', city: 'S182-CITY', postalCode: '00-182', country: 'PL' },
    orderConfirmationEmails: ['s182@example.test'],
    path: `/${id}/`,
    parentId: null,
  } as unknown as OrganizationRecord;
}

function harness() {
  const rows: Array<Record<string, unknown>> = [];
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => row[k] === v);
  const tx = {
    find: async (_entity: unknown, where: Record<string, unknown>) => rows.filter((r) => matches(r, where)),
    findOne: async (_entity: unknown, where: Record<string, unknown>) => rows.find((r) => matches(r, where)) ?? null,
    create: (_entity: unknown, data: Record<string, unknown>) => {
      const row = { id: randomUUID(), version: 1, createdAt: new Date(), updatedAt: new Date(), ...data };
      return row;
    },
    persist: (row: Record<string, unknown>) => {
      if (!rows.includes(row)) rows.push(row);
    },
    flush: async () => undefined,
  };
  const em = {
    fork: () => em,
    transactional: async <T>(fn: (scoped: unknown) => Promise<T>) => fn(tx),
    ...tx,
  };
  const entries: RecordAuditInput[] = [];
  const audit = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
  };
  const bus = new CommandBus({ em } as never, audit as never, new EventBus());
  const service = new LinkWriteService({
    emFactory: () => em as never,
    commandBus: bus,
    organizations: {
      findById: async (id: string) =>
        id === BUYER ? organization(BUYER, 'S182-BUYER-NAME') : id === PAYER ? organization(PAYER, 'S182-NAME') : null,
    } as never,
    addresses: {
      findById: async (orgId: string, id: string) =>
        orgId === PAYER && id === ADDRESS
          ? ({ id, organizationId: PAYER, kind: 'billing', street: 'S182-STREET', deletedAt: null } as unknown as AddressRecord)
          : null,
    } as never,
  });
  const asAdmin = <T>(fn: () => Promise<T>) => withSystemScopeActingFor(ADMIN, 'related_payers audit sentinel test', fn);
  const asAutomation = <T>(fn: () => Promise<T>) => withSystemScope('related_payers audit sentinel test', fn);
  return { service, entries, asAdmin, asAutomation };
}

function expectKeysAllowlisted(entries: readonly RecordAuditInput[]): void {
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    for (const state of [entry.stateBefore, entry.stateAfter]) {
      for (const key of Object.keys(state ?? {})) {
        expect(RELATED_PAYERS_AUDIT_KEYS, `${entry.action}: ${key}`).toContain(key);
      }
    }
  }
}

describe('payer link audit state carries names, never values (#470)', () => {
  it('the operator path: create, update, set_state, revoke', async () => {
    const h = harness();
    await h.asAdmin(async () => {
      const { link } = await h.service.create({
        buyerOrganizationId: BUYER,
        payerOrganizationId: PAYER,
        addressScope: { kind: 'one', billingAddressId: ADDRESS },
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: null,
        commercialTerms: 'buyer',
        notifyPayerOnOrders: false,
        origin: 'operator',
        actorKind: 'operator',
      });
      await h.service.update(link.id, { commercialTerms: 'payer', validTo: '2026-12-31T22:59:59.999Z' }, { actorKind: 'operator' });
      await h.service.setState(link.id, 'inactive', { actorKind: 'operator' });
      await h.service.revoke(link.id, { revokedByKind: 'operator', revokedById: ADMIN });
    });

    expectNoAuditValues(h.entries, SENTINELS);
    expectKeysAllowlisted(h.entries);
    expect(h.entries.map((e) => e.action)).toEqual([
      'related_payers.link.create',
      'related_payers.link.update',
      'related_payers.link.set_state',
      'related_payers.link.revoke',
    ]);
    const [create, update, setState, revoke] = h.entries;
    expect(create?.actorAdminUserId).toBe(ADMIN);
    expect(create?.stateAfter).toMatchObject({
      state: 'active',
      addressScope: 'one',
      billingAddressId: ADDRESS,
      commercialTerms: 'buyer',
      origin: 'operator',
      actorKind: 'operator',
      payerOrganizationId: PAYER,
    });
    // FR-118 — a change of terms names the field and records the codes before and after.
    expect(update?.stateAfter).toMatchObject({
      changedFields: ['commercialTerms', 'validTo'],
      commercialTerms: 'payer',
      validTo: '2026-12-31T22:59:59.999Z',
    });
    expect(update?.stateBefore).toMatchObject({ commercialTerms: 'buyer', validTo: null });
    expect(setState?.stateBefore).toEqual({ state: 'active' });
    expect(setState?.stateAfter).toMatchObject({ state: 'inactive', actorKind: 'operator' });
    expect(revoke?.stateAfter).toMatchObject({ state: 'revoked', revokedByKind: 'operator' });
  });

  it('the automation path records the actor kind and the source code', async () => {
    const h = harness();
    await h.asAutomation(async () => {
      const { link } = await h.service.create({
        buyerOrganizationId: BUYER,
        payerOrganizationId: PAYER,
        addressScope: { kind: 'all' },
        commercialTerms: 'payer',
        origin: 'automation',
        source: 'erp.sync-1',
        actorKind: 'automation',
      });
      await h.service.revoke(link.id, { revokedByKind: 'automation', revokedById: null, source: 'erp.sync-1' });
    });
    expectNoAuditValues(h.entries, SENTINELS);
    expectKeysAllowlisted(h.entries);
    expect(h.entries[0]?.actorAdminUserId ?? null).toBeNull();
    expect(h.entries[0]?.stateAfter).toMatchObject({ actorKind: 'automation', source: 'erp.sync-1', origin: 'automation' });
    expect(h.entries[1]?.stateAfter).toMatchObject({ revokedByKind: 'automation', source: 'erp.sync-1' });
  });

  it('RELATED_PAYERS_AUDIT_KEYS holds codes, ids and dates only', () => {
    for (const forbidden of ['organizationId', 'payerName', 'payerTaxId', 'name', 'taxId', 'email', 'comment']) {
      expect(RELATED_PAYERS_AUDIT_KEYS.has(forbidden), forbidden).toBe(false);
    }
  });
});
