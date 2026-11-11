import { AssertionError } from 'node:assert';
import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import type { Organization } from '../entities/organization.entity.js';
import { ORGANIZATION_AUDIT_KEYS } from '../services/organization-audit-state.js';
import { makeAdminPatchOrganizationCommand } from './admin-patch-organization.command.js';

/**
 * `organization.admin_patch` records names and structure, never values
 * (`specs/conventions/audit-state.md` §6, D-288, issue #470, owner ruling O-2):
 * the Organization *is* the tenant, and its name, tax id, reasons, order
 * e-mails and custom-field values are that tenant's values. The Command runs
 * through the real {@link CommandBus} over a fake ORM with a recording audit
 * port, so what is checked is what the bus hands the audit log.
 */

// ---------------------------------------------------------------------------
// The sentinel assertion. A local copy of `expectNoAuditValues` from
// `@endora-commerce/test-kit/audit`, as the other modules' sentinel tests keep
// it: this package does not depend on the test kit.
// ---------------------------------------------------------------------------
type Sentinel = string | number;

function expectNoAuditValues(entries: ReadonlyArray<Record<string, unknown>>, sentinels: readonly Sentinel[]): void {
  if (entries.length === 0) throw new AssertionError({ message: 'no audit entry to inspect' });
  const leaks: string[] = [];
  const hit = (text: string, sentinel: Sentinel) =>
    typeof sentinel === 'number' ? text.includes(String(sentinel)) : text.toLowerCase().includes(sentinel.toLowerCase());
  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined || value instanceof Date) return;
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`));
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        for (const sentinel of sentinels) if (typeof sentinel === 'string' && hit(key, sentinel)) leaks.push(`${path}{${key}}`);
        walk(child, `${path}.${key}`);
      }
      return;
    }
    for (const sentinel of sentinels) {
      if (typeof value === 'number' ? value === sentinel : hit(String(value), sentinel)) {
        leaks.push(`${path} = ${JSON.stringify(value)}`);
      }
    }
  };
  entries.forEach((entry, index) => {
    walk(entry['stateBefore'], `[${index}] ${String(entry['action'])} stateBefore`);
    walk(entry['stateAfter'], `[${index}] ${String(entry['action'])} stateAfter`);
  });
  if (leaks.length > 0) {
    throw new AssertionError({ message: `the audit log carries tenant-scoped values:\n  ${leaks.join('\n  ')}` });
  }
}
// ---------------------------------------------------------------------------

const ORG = '00000000-0000-4000-8000-0000000470a1';
const PARENT = '00000000-0000-4000-8000-0000000470a2';
const WAREHOUSE = '00000000-0000-4000-8000-0000000470a3';

const S = {
  name: 'S470-NAME',
  newName: 'S470-RENAMED',
  legalName: 'S470-LEGAL',
  taxId: 'S470TAXID47',
  street: 'S470-STREET',
  email: 's470@example.test',
  newEmail: 's470-new@example.test',
  blockedReason: 'S470-BLOCK-REASON',
  rejectedReason: 'S470-REJECT-REASON',
  customField: 'S470-CF',
} as const;

function sentinelOrganization(): Organization {
  return {
    id: ORG,
    name: S.name,
    legalName: S.legalName,
    taxId: S.taxId,
    status: 'blocked',
    vatStatus: 'vat_payer',
    isPersonal: false,
    registeredAddress: { street: S.street, city: 'S470-CITY', postalCode: '47-047', country: 'PL' },
    orderConfirmationEmails: [S.email],
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
    parentId: PARENT,
    path: `/${PARENT}/${ORG}/`,
    version: 4,
    blockedReason: S.blockedReason,
    blockedAt: new Date('2026-11-01T00:00:00Z'),
    rejectedReason: S.rejectedReason,
    rejectedAt: null,
    approvedAt: null,
    customFieldValues: { tier: `${S.customField}-OLD`, region: `${S.customField}-KEPT`, legacy: `${S.customField}-GONE` },
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    deletedAt: null,
  } as unknown as Organization;
}

function harness() {
  const org = sentinelOrganization();
  const audits: Array<Record<string, unknown>> = [];
  const em = {
    async findOne(_entity: unknown, where: { id: string }) {
      return where.id === ORG ? org : null;
    },
    async flush() {},
    async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
      return cb(em as unknown as EntityManager);
    },
  };
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  const audit = {
    recordWithin(_em: EntityManager, input: Record<string, unknown>) {
      audits.push(input);
      return {} as never;
    },
  } as unknown as AuditPort;
  const bus = new CommandBus(orm, audit, new EventBus<Record<string, EventBase>>());
  return { org, audits, bus };
}

const asSystem = <T>(fn: () => Promise<T>): Promise<T> =>
  withSystemScope('organizations unit test: admin patch sentinel', fn);

const SENTINELS = [
  S.name,
  S.newName,
  S.legalName,
  S.taxId,
  S.street,
  S.email,
  S.newEmail,
  S.blockedReason,
  S.rejectedReason,
  S.customField,
  ORG,
  PARENT,
];

describe('organization.admin_patch — audit state (D-288, #470 O-2)', () => {
  it('records the names of the changed fields and custom fields, and no value', async () => {
    const h = harness();

    await asSystem(() =>
      h.bus.run(
        makeAdminPatchOrganizationCommand({
          organizationId: ORG,
          changes: {
            name: S.newName,
            status: 'active',
            orderConfirmationEmails: [S.email, S.newEmail],
            fulfilmentStrategy: 'defined_order',
            fulfilmentStrategyWarehouseOrder: [WAREHOUSE],
            // Sent, but the same as stored: not a change.
            vatStatus: 'vat_payer',
          },
          assertCurrent: () => {},
          mergeCustomFieldValues: async (current) => {
            const next: Record<string, unknown> = { ...current, tier: S.customField, acquisition_source: `${S.customField}-NEW` };
            delete next['legacy'];
            return next;
          },
        }),
      ),
    );

    expect(h.org.name).toBe(S.newName);
    expect(h.org.customFieldValues).toMatchObject({ tier: S.customField, region: `${S.customField}-KEPT` });

    expectNoAuditValues(h.audits, SENTINELS);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'organization.admin_patch',
      objectType: 'organization',
      objectId: ORG,
      stateBefore: { status: 'blocked', vatStatus: 'vat_payer', fulfilmentStrategy: null },
      stateAfter: {
        status: 'active',
        vatStatus: 'vat_payer',
        fulfilmentStrategy: 'defined_order',
        changedFields: ['fulfilmentStrategy', 'fulfilmentStrategyWarehouseOrder', 'name', 'orderConfirmationEmails', 'status'],
        changedCustomFields: ['acquisition_source', 'legacy', 'tier'],
      },
    });
  });

  it('records empty name lists when a PATCH changes nothing', async () => {
    const h = harness();
    await asSystem(() =>
      h.bus.run(
        makeAdminPatchOrganizationCommand({
          organizationId: ORG,
          changes: { name: S.name },
          assertCurrent: () => {},
        }),
      ),
    );
    expectNoAuditValues(h.audits, SENTINELS);
    expect(h.audits[0]).toMatchObject({ stateAfter: { changedFields: [], changedCustomFields: [] } });
  });

  it('holds every recorded top-level key to ORGANIZATION_AUDIT_KEYS', async () => {
    const h = harness();
    await asSystem(() =>
      h.bus.run(
        makeAdminPatchOrganizationCommand({
          organizationId: ORG,
          changes: { name: S.newName, status: 'active' },
          assertCurrent: () => {},
          mergeCustomFieldValues: async (current) => ({ ...current, tier: S.customField }),
        }),
      ),
    );
    const keys = h.audits.flatMap((entry) => [
      ...Object.keys((entry['stateBefore'] ?? {}) as object),
      ...Object.keys((entry['stateAfter'] ?? {}) as object),
    ]);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(ORGANIZATION_AUDIT_KEYS.has(key), key).toBe(true);
  });
});
