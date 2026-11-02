import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_ACCOUNT_ANONYMIZED_EVENT,
  CustomerAccountAnonymizedEventV1Schema,
  type CustomerAccountAnonymizedEventV1,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { CustomerAccountLifecycleWriteService } from './customer-account-lifecycle-ports.js';

/**
 * `customer_account.anonymized.v1` (`specs/170-forms-module/` contracts/events-and-webhook.md §3,
 * research R-17): `anonymize` announces the irreversible step once, after its write and its audit
 * row, so a module holding data attributed to the account can erase it in the same sweep step. An
 * account that was already anonymised announces nothing.
 */

const ACCOUNT_ID = '00000000-0000-4000-8000-0000000c0a01';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000c0a02';

function harness() {
  const steps: string[] = [];
  const emitted: CustomerAccountAnonymizedEventV1[] = [];
  const account = Object.assign(Object.create(CustomerAccount.prototype) as CustomerAccount, {
    id: ACCOUNT_ID,
    organizationId: ORGANIZATION_ID,
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'admin',
    passwordHash: 'hash',
    anonymizedAt: null,
    deletedAt: new Date('2026-01-01T00:00:00Z'),
  });
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== CustomerAccount) throw new Error('unexpected entity');
      return where['id'] === ACCOUNT_ID ? account : null;
    },
    flush: async () => {
      steps.push('flush');
    },
  } as unknown as EntityManager;
  const audit = {
    record: async (entry: { action: string }) => {
      steps.push(`audit:${entry.action}`);
    },
  } as unknown as AuditPort;
  const service = new CustomerAccountLifecycleWriteService(
    () => em,
    audit,
    async () => new Set<string>(),
    {} as PersonalOrganizationProvisionApi,
    undefined,
    async (payload) => {
      steps.push('emit');
      emitted.push(payload);
    },
  );
  return { service, steps, emitted, account };
}

describe('CustomerAccountLifecycleWriteService.anonymize — the anonymisation event', () => {
  it('names the event as the contract does', () => {
    expect(CUSTOMER_ACCOUNT_ANONYMIZED_EVENT).toBe('customer_account.anonymized.v1');
  });

  it('emits once on the transition, after the flush and the audit row, with the account and its organisation', async () => {
    const { service, steps, emitted } = harness();

    await service.anonymize(ACCOUNT_ID);

    expect(steps).toEqual(['flush', 'audit:customer_account.anonymized', 'emit']);
    expect(emitted).toHaveLength(1);
    const event = CustomerAccountAnonymizedEventV1Schema.parse(emitted[0]);
    expect(event).toMatchObject({ customerAccountId: ACCOUNT_ID, organizationId: ORGANIZATION_ID });
    expect(event.eventId).not.toBe('');
  });

  it('emits nothing for an account that is already anonymised', async () => {
    const { service, emitted } = harness();

    await service.anonymize(ACCOUNT_ID);
    await service.anonymize(ACCOUNT_ID);

    expect(emitted).toHaveLength(1);
  });

  it('carries no e-mail, name or other personal data in the payload', async () => {
    const { service, emitted } = harness();
    await service.anonymize(ACCOUNT_ID);
    expect(Object.keys(emitted[0]!).sort()).toEqual(['customerAccountId', 'eventId', 'occurredAt', 'organizationId']);
  });
});
