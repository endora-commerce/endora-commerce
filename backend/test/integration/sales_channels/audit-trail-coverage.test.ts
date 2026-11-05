import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SALES_CHANNEL_AUDIT_ACTIONS } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { testChannelBridges } from '../../helpers/channel-bridges.js';
import { EventBus } from '@endora-commerce/platform/events';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { SalesChannelAttributionRegistry } from '../../../../packages/modules/sales_channels/src/backend/services/sales-channel-attribution-registry.js';
import { SalesChannelsService } from '../../../../packages/modules/sales_channels/src/backend/services/sales-channels.service.js';
import { dictionaryValidatorFor } from '../../helpers/dictionary-services.js';
import { SalesChannelMembershipService } from '../../../src/kernel/sales-channels/sales-channel-membership.service.js';
import { DefaultChannelReconciler } from '@endora-commerce/platform/composition';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Product } from '../../helpers/package-entities.js';
import { MissingTenantContextError } from '@endora-commerce/platform/tenancy';
import { runWithoutTenantContext } from '../../../src/tenancy/tenant-context.js';
import { transactionBoundCommandBus } from '../../helpers/sales-channels-service.js';

/**
 * T048 — Audit-trail coverage (FR-019).
 *
 * Every identity change, lifecycle change, and membership change must
 * land an `audit_log_entries` row with the right action code. The
 * action codes are owned by the contracts package
 * (`SALES_CHANNEL_AUDIT_ACTIONS`); this test exercises every path
 * that the spec requires.
 */
describe('audit trail coverage (T048)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
  });

  /** The service as the module composes it, with its Command Bus bound to the test transaction. */
  function identityService(): SalesChannelsService {
    const auditLogService = new AuditLogService(() => db.em());
    const eventBus = new EventBus();
    return new SalesChannelsService(
      () => db.em(),
      eventBus,
      // Required since feature 075 (D-87). The codes this suite seeds are
      // active, so the validator accepts exactly what the deleted raw
      // `select` accepted — and refuses an inactive one, which it did not.
      dictionaryValidatorFor(() => db.em()),
      new SalesChannelAttributionRegistry(),
      // Feature 120 (FR-015) — which table holds each entity type's
      // memberships. This suite composes no platform, so the descriptors are
      // the ones `setupTestDb` declared from their owning modules.
      testChannelBridges(),
      transactionBoundCommandBus(() => db.em(), auditLogService, eventBus),
      auditLogService,
    );
  }

  /**
   * Identity writes are Commands (Principle XIII, raised by issue #467), so the row is
   * the Command Bus's: one per write, `stateBefore` / `stateAfter` holding the
   * channel snapshots (`stateBefore` null on create), the actor taken from the
   * ambient TenantContext, written in the write's own transaction. Until then
   * the service wrote it by hand as `stateAfter: { action, before, after }`.
   */
  it('writes one identity audit row per create and update, with before/after snapshots', async () => {
    try {
      const em = db.em();
      // Ensure language + currency seeds the create-validate path needs.
      // Bypassing the partial-unique index on `is_default` is easier with
      // `is_default = false` than juggling cross-test state.
      await em.persistAndFlush(
        em.create(
          (await import('../../helpers/package-entities.js')).Language,
          { code: 'en-T048', label: 'English (T048)', isDefault: false, isActive: true, sortOrder: 99 },
        ),
      );
      await em.persistAndFlush(
        em.create(
          (await import('../../helpers/package-entities.js')).Currency,
          {
            code: 'XEU',
            label: 'Euro (T048)',
            symbol: '€',
            isDefault: false,
            isActive: true,
            sortOrder: 99,
          },
        ),
      );

      const svc = identityService();

      const created = await svc.create({
        code: 't048-channel',
        name: { en: 'T048' },
        languages: ['en-T048'],
        defaultLanguage: 'en-T048',
        currencies: ['XEU'],
        defaultCurrency: 'XEU',
        active: true,
      });
      expect(created.code).toBe('t048-channel');

      const identityRows = () =>
        em.find(
          AuditLogEntry,
          { action: SALES_CHANNEL_AUDIT_ACTIONS.IDENTITY_CHANGED, objectId: created.id },
          { orderBy: { actedAt: 'asc' }, refresh: true },
        );

      const [createRow] = await identityRows();
      expect(createRow?.objectType).toBe('sales_channel');
      // No state before a create.
      expect(createRow?.stateBefore ?? null).toBeNull();
      expect(createRow?.stateAfter).toMatchObject({
        id: created.id,
        code: 't048-channel',
        name: { en: 'T048' },
        anonymousAccess: true,
        version: 1,
      });

      await svc.update('t048-channel', { name: { en: 'Renamed' }, anonymousAccess: false }, 1);

      const rows = await identityRows();
      // Create + update = 2 audit rows.
      expect(rows.length).toBe(2);
      expect(rows[1]!.stateBefore).toMatchObject({
        name: { en: 'T048' },
        anonymousAccess: true,
        version: 1,
      });
      expect(rows[1]!.stateAfter).toMatchObject({
        name: { en: 'Renamed' },
        anonymousAccess: false,
        version: 2,
      });

      // A refused write audits nothing: the stale version is refused before
      // the Command runs, and a duplicate code rolls the Command back.
      await expect(svc.update('t048-channel', { name: { en: 'Stale' } }, 1)).rejects.toMatchObject({ statusCode: 412 });
      await expect(
        svc.create({
          code: 't048-channel',
          name: { en: 'Duplicate' },
          languages: ['en-T048'],
          defaultLanguage: 'en-T048',
          currencies: ['XEU'],
          defaultCurrency: 'XEU',
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect((await identityRows()).length).toBe(2);
    } finally {
      await db.rollbackTx();
    }
  });

  it('refuses an identity write with no ambient TenantContext, and writes nothing', async () => {
    try {
      const em = db.em();
      const svc = identityService();
      const before = await em.count(AuditLogEntry, {
        action: SALES_CHANNEL_AUDIT_ACTIONS.IDENTITY_CHANGED,
      });
      const def = await em.findOneOrFail(SalesChannel, { systemDefault: true });

      // The harness enters a system TenantContext for every test
      // (`test/tenancy-setup.ts`); this write runs with none, as a caller
      // outside any request would.
      await expect(
        runWithoutTenantContext(() =>
          svc.update(def.code, { anonymousAccess: !def.anonymousAccess }, def.version),
        ),
      ).rejects.toBeInstanceOf(MissingTenantContextError);

      expect(
        await em.count(AuditLogEntry, { action: SALES_CHANNEL_AUDIT_ACTIONS.IDENTITY_CHANGED }),
      ).toBe(before);
      expect((await em.findOneOrFail(SalesChannel, { id: def.id }, { refresh: true })).version).toBe(
        def.version,
      );
    } finally {
      await db.rollbackTx();
    }
  });

  it('writes lifecycle audit on deactivate, activate, and delete', async () => {
    try {
      const em = db.em();
      await new DefaultChannelReconciler(() => em, new AuditLogService(() => db.em())).run();

      const auditLogService = new AuditLogService(() => db.em());
      const eventBus = new EventBus();
      const svc = new SalesChannelsService(
        () => db.em(),
        eventBus,
        // Required since feature 075 (D-87). The codes this suite seeds are
        // active, so the validator accepts exactly what the deleted raw
        // `select` accepted — and refuses an inactive one, which it did not.
        dictionaryValidatorFor(() => db.em()),
        new SalesChannelAttributionRegistry(),
        // Feature 120 (FR-015) — which table holds each entity type's
        // memberships. This suite composes no platform, so the descriptors are
        // the ones `setupTestDb` declared from their owning modules.
        testChannelBridges(),
        transactionBoundCommandBus(() => db.em(), auditLogService, eventBus),
        auditLogService,
      );

      // Create a non-default channel through the service so we can deactivate / delete it.
      // Use raw SQL to side-step the create path's language validation (this test only
      // cares about the lifecycle audit emissions).
      const chanId = await em
        .getConnection()
        .execute<Array<{ id: string }>>(
          `insert into "sales_channels" ("id","code","name","default_language","default_currency","status","languages","currencies","active","system_default","version","created_at","updated_at") ` +
            `values (gen_random_uuid(), 't048-life', '{"en":"L"}'::jsonb, 'en', 'EUR', 'active', '["en"]'::jsonb, '["EUR"]'::jsonb, true, false, 1, now(), now()) returning "id"`,
          [],
          'all',
          em.getTransactionContext(),
        );
      const id = chanId[0]!.id;

      await svc.deactivate('t048-life');
      await svc.activate('t048-life');
      await svc.delete('t048-life');

      const lifecycleRows = await em.find(AuditLogEntry, {
        action: SALES_CHANNEL_AUDIT_ACTIONS.LIFECYCLE_CHANGED,
        objectId: id,
      });
      expect(lifecycleRows.length).toBeGreaterThanOrEqual(3);

      const ops = lifecycleRows
        .map((r) => (r.stateAfter as { action?: string } | null)?.action)
        .filter((s): s is string => typeof s === 'string')
        .sort();
      expect(ops).toEqual(['activated', 'deactivated', 'deleted']);
    } finally {
      await db.rollbackTx();
    }
  });

  it('writes membership audit on add and remove', async () => {
    try {
      const em = db.em();
      await new DefaultChannelReconciler(() => em).run();

      // Need a Product fixture to bind into the channel.
      const product = em.create(Product, {
        sku: 'T048-AUDIT',
        slug: 't048-audit',
        type: 'simple',
        status: 'inactive',
        name: 'T048',
        description: 'fixture',
        visibility: 'public',
        attributeValues: {},
        allowedOrganizationIds: [],
      });
      await em.persistAndFlush(product);

      const channel = em.create(SalesChannel, {
        code: 't048-mem',
        name: { en: 'M' },
        defaultLanguage: 'en',
        defaultCurrency: 'EUR',
        languages: ['en'],
        currencies: ['EUR'],
        active: true,
        systemDefault: false,
        version: 1,
      });
      await em.persistAndFlush(channel);

      const auditLogService = new AuditLogService(() => db.em());
      const eventBus = new EventBus();
      const svc = new SalesChannelMembershipService(
        () => db.em(),
        eventBus,
        auditLogService,
      );

      await svc.addToChannel(channel.id, 'product', product.id);
      await svc.removeFromChannel(channel.id, 'product', product.id, {
        fallbackToDefault: true,
      });

      const rows = await em.find(AuditLogEntry, {
        action: SALES_CHANNEL_AUDIT_ACTIONS.MEMBERSHIP_CHANGED,
      });
      // Three rows: explicit add, the rebind add (fallback to Default),
      // and the remove. Order isn't asserted; only the action mix.
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const ops = rows
        .map((r) => (r.stateAfter as { op?: string } | null)?.op)
        .filter((s): s is string => typeof s === 'string')
        .sort();
      expect(ops).toContain('add');
      expect(ops).toContain('remove');
    } finally {
      await db.rollbackTx();
    }
  });
});
