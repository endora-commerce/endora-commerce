import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import type { ApplicationRule } from '@endora-commerce/contracts';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { CustomerGroup } from '../../../src/modules/customer_accounts/entities/customer-group.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { Category } from '../../../src/modules/catalog/entities/category.entity.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';
import { DefaultPriceListMigrator } from '../../../src/modules/price_lists/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * Feature 011 / US4 — Rule normalisation + target validation (T051).
 *
 * Verifies the service-level rule normaliser:
 *   - Deduplicates values within a criterion.
 *   - Drops empty groups (groups whose children become empty after recursion).
 *   - Rejects unknown target IDs (sales channel / customer group / organization /
 *     category) with a structured error.
 *   - Uppercases ISO-4217 currency codes; rejects malformed ones.
 *   - Refuses to activate a non-Default list with an empty rule (FR-023).
 */
describe('Feature 011 / US4 — rule normalisation + target validation (T051)', () => {
  let db: TestDb;
  let salesChannelId: string;
  let customerGroupId: string;
  let organizationId: string;
  let categoryId: string;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
    const em = db.em();
    const migrator = new DefaultPriceListMigrator(() => em);
    await migrator.seedDefault();

    const sc = em.create(SalesChannel, {
      code: 'sc-rule-test',
      name: { 'pl-PL': 'Test', 'en-US': 'Test' },
      isPublic: true,
      defaultLanguage: 'pl-PL',
      defaultCurrency: 'PLN',
      languages: ['pl-PL'],
      currencies: ['PLN'],
    });
    const cg = em.create(CustomerGroup, { code: 'cg-rule-test', name: 'VIP rule test' });
    const cat = em.create(Category, {
      slug: 'rule-test-cat',
      name: { 'pl-PL': 'Test', 'en-US': 'Test' },
      sortOrder: 0,
    });
    await em.persistAndFlush([sc, cg, cat]);

    const org = em.create(Organization, {
      name: 'Rule Test Org',
      taxId: `RULE-${Date.now()}`,
      vatStatus: 'vat_payer',
      status: 'active',
      registeredAddress: {
        street: 'Test 1',
        city: 'Warsaw',
        postalCode: '00-001',
        country: 'PL',
      },
    });
    await em.persistAndFlush(org);

    salesChannelId = sc.id;
    customerGroupId = cg.id;
    organizationId = org.id;
    categoryId = cat.id;
  });

  it('deduplicates values within a criterion', async () => {
    try {
      const svc = new PriceListService(
        () => db.em(),
        undefined,
        undefined,
        undefined,
        neighbourReadPorts(() => db.em()),
      );
      const rule: ApplicationRule = {
        kind: 'criterion',
        type: 'salesChannel',
        values: [salesChannelId, salesChannelId, salesChannelId],
      };
      const created = await svc.create({ name: 'Dedupe', type: 'sale', applicationRule: rule });
      expect((created.applicationRule as { values: string[] }).values).toEqual([salesChannelId]);
    } finally {
      await db.rollbackTx();
    }
  });

  it('uppercases currency codes and rejects malformed ones', async () => {
    try {
      const svc = new PriceListService(
        () => db.em(),
        undefined,
        undefined,
        undefined,
        neighbourReadPorts(() => db.em()),
      );
      const ok: ApplicationRule = { kind: 'criterion', type: 'currency', values: ['pln'] };
      const created = await svc.create({ name: 'CurOK', type: 'sale', applicationRule: ok });
      expect((created.applicationRule as { values: string[] }).values).toEqual(['PLN']);

      const bad: ApplicationRule = { kind: 'criterion', type: 'currency', values: ['PL'] };
      await expect(
        svc.create({ name: 'CurBad', type: 'sale', applicationRule: bad }),
      ).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      await db.rollbackTx();
    }
  });

  it('rejects unknown sales-channel / customer-group / organization / category IDs', async () => {
    try {
      const svc = new PriceListService(
        () => db.em(),
        undefined,
        undefined,
        undefined,
        neighbourReadPorts(() => db.em()),
      );
      const fakeUuid = '00000000-0000-4000-8000-000000fffffe';
      for (const t of ['salesChannel', 'customerGroup', 'organization', 'category'] as const) {
        const rule: ApplicationRule = { kind: 'criterion', type: t, values: [fakeUuid] };
        await expect(
          svc.create({ name: `Bad-${t}`, type: 'sale', applicationRule: rule }),
        ).rejects.toMatchObject({ statusCode: 400 });
      }
    } finally {
      await db.rollbackTx();
    }
  });

  it('accepts valid IDs across every criterion type', async () => {
    try {
      const svc = new PriceListService(
        () => db.em(),
        undefined,
        undefined,
        undefined,
        neighbourReadPorts(() => db.em()),
      );
      const rule: ApplicationRule = {
        kind: 'group',
        op: 'AND',
        children: [
          { kind: 'criterion', type: 'salesChannel', values: [salesChannelId] },
          { kind: 'criterion', type: 'customerGroup', values: [customerGroupId] },
          { kind: 'criterion', type: 'organization', values: [organizationId] },
          { kind: 'criterion', type: 'category', values: [categoryId] },
          { kind: 'criterion', type: 'currency', values: ['PLN'] },
        ],
      };
      const created = await svc.create({ name: 'AllOK', type: 'sale', applicationRule: rule });
      expect(created.applicationRule).toEqual(rule);
    } finally {
      await db.rollbackTx();
    }
  });

  it('drops empty groups produced by deletion of all children', async () => {
    try {
      const svc = new PriceListService(
        () => db.em(),
        undefined,
        undefined,
        undefined,
        neighbourReadPorts(() => db.em()),
      );
      const rule: ApplicationRule = {
        kind: 'group',
        op: 'AND',
        children: [
          { kind: 'criterion', type: 'salesChannel', values: [salesChannelId] },
          {
            kind: 'group',
            op: 'OR',
            children: [{ kind: 'criterion', type: 'currency', values: [] }],
          },
        ],
      };
      const created = await svc.create({ name: 'DropEmpty', type: 'sale', applicationRule: rule });
      // The inner OR group's only child is an empty-criterion (always-true).
      // Normaliser drops the always-true criterion, leaving the OR group with
      // no children, which collapses to `{ kind: 'all' }`, which the outer AND
      // group drops. The outer AND is then left with a single child — itself
      // the salesChannel criterion — and collapses to that criterion.
      expect((created.applicationRule as { kind: string }).kind).toBe('criterion');
      expect((created.applicationRule as { type: string }).type).toBe('salesChannel');
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-023: refuses to activate a non-Default list with an empty rule', async () => {
    try {
      const svc = new PriceListService(
        () => db.em(),
        undefined,
        undefined,
        undefined,
        neighbourReadPorts(() => db.em()),
      );
      const created = await svc.create({ name: 'No Rule', type: 'sale' });
      expect(created.applicationRule).toEqual({ kind: 'all' });
      await expect(svc.activate(created.id)).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-006: still refuses to attach a non-empty rule to Default', async () => {
    try {
      const svc = new PriceListService(
        () => db.em(),
        undefined,
        undefined,
        undefined,
        neighbourReadPorts(() => db.em()),
      );
      const { DEFAULT_PRICE_LIST_ID } =
        await import('../../../src/modules/price_lists/services/default-price-list-migration.js');
      const rule: ApplicationRule = {
        kind: 'criterion',
        type: 'salesChannel',
        values: [salesChannelId],
      };
      await expect(
        svc.patch(DEFAULT_PRICE_LIST_ID, { applicationRule: rule }),
      ).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      await db.rollbackTx();
    }
  });

  it('depth limit 5 (FR-020) enforced by the schema — Zod-level rejection', async () => {
    try {
      // 6-deep nested groups.
      let inner: ApplicationRule = {
        kind: 'criterion',
        type: 'salesChannel',
        values: [salesChannelId],
      };
      for (let i = 0; i < 6; i += 1) {
        inner = { kind: 'group', op: 'AND', children: [inner] };
      }
      const svc = new PriceListService(
        () => db.em(),
        undefined,
        undefined,
        undefined,
        neighbourReadPorts(() => db.em()),
      );
      await expect(
        svc.create({ name: 'Too Deep', type: 'sale', applicationRule: inner }),
      ).rejects.toBeTruthy();
    } finally {
      await db.rollbackTx();
    }
  });
});
