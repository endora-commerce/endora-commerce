/**
 * `customer_accounts`' demo data (feature 160, FR-044 — the *VIP* group of the
 * E3 scenario): what no database comparison can see. A second seed creates
 * nothing, and the withdrawal is filtered by the code the seed assigned — an
 * operator's own groups, a `VIP` among them, are left alone.
 */
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { ModuleDemoContext } from '@endora-commerce/contracts';
import { CustomerGroup } from '../entities/customer-group.entity.js';
import { DEMO_CUSTOMER_GROUP } from './rows.js';
import { seedDemo } from './seed.js';
import { resetDemo } from './reset.js';

function fakeEm(existing: readonly string[] = []): {
  em: EntityManager;
  created: Record<string, unknown>[];
  deletes: unknown[];
} {
  const codes = new Set(existing);
  const created: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  const em = {
    findOne: async (_entity: unknown, where: { code: string }) => (codes.has(where.code) ? { code: where.code } : null),
    create: (_entity: unknown, payload: Record<string, unknown>) => {
      const code = payload['code'] as string;
      if (codes.has(code)) throw new Error(`duplicate key: ${code}`);
      codes.add(code);
      created.push(payload);
      return payload;
    },
    flush: async () => undefined,
    nativeDelete: async (entity: { name: string }, where: unknown) => {
      deletes.push({ [entity.name]: where });
      return 1;
    },
  };
  return { em: em as unknown as EntityManager, created, deletes };
}

function contextOver(em: EntityManager): ModuleDemoContext<ModuleContext> {
  return {
    ctx: { cradle: () => ({ emFactory: () => em }) } as unknown as ModuleContext,
  } as unknown as ModuleDemoContext<ModuleContext>;
}

describe('customer_accounts demo data', () => {
  it('creates the VIP group under a demo code', async () => {
    const { em, created } = fakeEm();
    const result = await seedDemo(contextOver(em));
    expect(created).toEqual([{ code: DEMO_CUSTOMER_GROUP.code, name: 'VIP', description: DEMO_CUSTOMER_GROUP.description }]);
    expect(DEMO_CUSTOMER_GROUP.code).not.toBe('VIP');
    expect(result.created).toEqual([{ entity: 'CustomerGroup', count: 1 }]);
  });

  it('creates nothing on a second run and reports the same count', async () => {
    const { em, created } = fakeEm([DEMO_CUSTOMER_GROUP.code]);
    const result = await seedDemo(contextOver(em));
    expect(created).toEqual([]);
    expect(result.created).toEqual([{ entity: 'CustomerGroup', count: 1 }]);
  });

  it('withdraws by the code it assigned, never by the table', async () => {
    const { em, deletes } = fakeEm([DEMO_CUSTOMER_GROUP.code, 'VIP']);
    await resetDemo(contextOver(em));
    expect(deletes).toEqual([{ CustomerGroup: { code: DEMO_CUSTOMER_GROUP.code } }]);
  });

  it('is declared over the entity this module owns', () => {
    expect(CustomerGroup.name).toBe('CustomerGroup');
  });
});
