import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import type { Organization } from '../entities/organization.entity.js';
import { makeDeleteOrganizationCommand } from './delete-organization.command.js';

/**
 * `organization.delete` (issue #1338, Principle XIII): the soft delete runs on
 * the bus, so the write and its one audit entry share a transaction. The
 * Command runs through the real {@link CommandBus} over a fake ORM with a
 * recording audit port, so what is checked is what the bus hands the audit log.
 */

const ORG = '00000000-0000-4000-8000-000000133801';
const PARENT = '00000000-0000-4000-8000-000000133802';

function organization(): Organization {
  return {
    id: ORG,
    name: 'S1338-NAME',
    legalName: 'S1338-LEGAL',
    taxId: 'S1338TAXID',
    status: 'active',
    vatStatus: 'vat_payer',
    isPersonal: false,
    parentId: PARENT,
    path: `/${PARENT}/${ORG}/`,
    version: 3,
    deletedAt: null,
  } as unknown as Organization;
}

function harness(options: { children?: number; failFlush?: boolean } = {}) {
  const org = organization();
  const audits: Array<Record<string, unknown>> = [];
  let flushes = 0;
  const em = {
    async findOne(_entity: unknown, where: { id: string; deletedAt: null }) {
      return where.id === ORG && org.deletedAt === null ? org : null;
    },
    async count(_entity: unknown, where: { parentId: string }) {
      return where.parentId === ORG ? (options.children ?? 0) : 0;
    },
    async flush() {
      if (options.failFlush) throw new Error('flush failed');
      flushes += 1;
    },
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
  return { org, audits, bus, flushes: () => flushes };
}

const asSystem = <T>(fn: () => Promise<T>): Promise<T> =>
  withSystemScope('organizations unit test: organization delete', fn);

describe('organization.delete (issue #1338)', () => {
  it('soft-deletes the Organization and records exactly one entry, names and structure only', async () => {
    const { org, audits, bus, flushes } = harness();
    await asSystem(() => bus.run(makeDeleteOrganizationCommand({ organizationId: ORG })));

    expect(org.deletedAt).toBeInstanceOf(Date);
    expect(flushes()).toBe(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'organization.delete',
      objectType: 'organization',
      objectId: ORG,
      stateBefore: { status: 'active', vatStatus: 'vat_payer', isPersonal: false, parentId: PARENT, version: 3 },
      stateAfter: null,
    });
    expect(JSON.stringify(audits[0])).not.toMatch(/S1338/);
  });

  it('refuses 409 has_children while a child exists, and records nothing', async () => {
    const { org, audits, bus } = harness({ children: 1 });
    await expect(asSystem(() => bus.run(makeDeleteOrganizationCommand({ organizationId: ORG })))).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(org.deletedAt).toBeNull();
    expect(audits).toHaveLength(0);
  });

  it('answers 404 for an unknown or malformed id, and records nothing', async () => {
    const { audits, bus } = harness();
    for (const organizationId of ['00000000-0000-4000-8000-0000001338ff', 'not-a-uuid']) {
      await expect(asSystem(() => bus.run(makeDeleteOrganizationCommand({ organizationId })))).rejects.toMatchObject({
        statusCode: 404,
      });
    }
    expect(audits).toHaveLength(0);
  });

  it('records no entry when the write fails', async () => {
    const { audits, bus } = harness({ failFlush: true });
    await expect(asSystem(() => bus.run(makeDeleteOrganizationCommand({ organizationId: ORG })))).rejects.toThrow(
      'flush failed',
    );
    expect(audits).toHaveLength(0);
  });
});
