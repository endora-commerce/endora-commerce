import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import type { CustomerAccountAnonymizedEventV1 } from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { CustomerAccountLifecycleWriteService } from './customer-account-lifecycle-ports.js';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` research R-12, FR-041, FR-042):
 * anonymisation clears the whole custom-field bag — a buyer may have typed a
 * phone number into it at registration — and neither the audit row nor the
 * event carries any of its values.
 */

const ACCOUNT_ID = '00000000-0000-4000-8000-0000000c1761';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000c1762';

function harness() {
  const audits: Array<{ action: string; stateBefore?: unknown; stateAfter?: unknown }> = [];
  const emitted: CustomerAccountAnonymizedEventV1[] = [];
  const account = Object.assign(Object.create(CustomerAccount.prototype) as CustomerAccount, {
    id: ACCOUNT_ID,
    organizationId: ORGANIZATION_ID,
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    passwordHash: 'hash',
    anonymizedAt: null,
    deletedAt: new Date('2026-01-01T00:00:00Z'),
    customFieldValues: { phone: '+48 600 000 000', vat_contact: 'Ada' },
  });
  const em = {
    findOne: async (_entity: unknown, where: Record<string, unknown>) =>
      where['id'] === ACCOUNT_ID ? account : null,
    flush: async () => undefined,
  } as unknown as EntityManager;
  const audit = {
    record: async (entry: { action: string; stateBefore?: unknown; stateAfter?: unknown }) => {
      audits.push(entry);
    },
  } as unknown as AuditPort;
  const service = new CustomerAccountLifecycleWriteService(
    () => em,
    audit,
    async () => new Set<string>(),
    {} as PersonalOrganizationProvisionApi,
    undefined,
    async (payload) => {
      emitted.push(payload);
    },
  );
  return { service, account, audits, emitted };
}

describe('CustomerAccountLifecycleWriteService.anonymize — custom-field values (feature 175)', () => {
  it('clears the custom-field bag', async () => {
    const { service, account } = harness();

    const record = await service.anonymize(ACCOUNT_ID);

    expect(account.customFieldValues).toEqual({});
    expect(record.customFieldValues).toEqual({});
  });

  it('keeps the audit `before` to the e-mail alone — no custom-field value', async () => {
    const { service, audits } = harness();

    await service.anonymize(ACCOUNT_ID);

    const entry = audits.find((a) => a.action === 'customer_account.anonymized');
    expect(entry?.stateBefore).toEqual({ email: 'ada@example.com' });
    expect(JSON.stringify(entry)).not.toContain('+48 600 000 000');
  });

  it('emits ids only', async () => {
    const { service, emitted } = harness();

    await service.anonymize(ACCOUNT_ID);

    expect(Object.keys(emitted[0]!).sort()).toEqual(['customerAccountId', 'eventId', 'occurredAt', 'organizationId']);
    expect(JSON.stringify(emitted[0])).not.toContain('+48');
  });
});
