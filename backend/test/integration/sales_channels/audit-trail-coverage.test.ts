import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SALES_CHANNEL_AUDIT_ACTIONS } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
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

  it('writes identity audit on create and update', async () => {
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
        auditLogService,
      );

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

      const createAudit = await em.find(AuditLogEntry, {
        action: SALES_CHANNEL_AUDIT_ACTIONS.IDENTITY_CHANGED,
        objectId: created.id,
      });
      expect(createAudit.length).toBe(1);

      await svc.update('t048-channel', { name: { en: 'Renamed' } }, 1);

      const allIdentity = await em.find(AuditLogEntry, {
        action: SALES_CHANNEL_AUDIT_ACTIONS.IDENTITY_CHANGED,
        objectId: created.id,
      });
      // Create + update = 2 audit rows.
      expect(allIdentity.length).toBe(2);
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
        auditLogService,
      );

      // Create a non-default channel through the service so we can deactivate / delete it.
      // Use raw SQL to side-step the create path's language validation (this test only
      // cares about the lifecycle audit emissions).
      const chanId = await em
        .getConnection()
        .execute<Array<{ id: string }>>(
          `insert into "sales_channels" ("id","code","name","is_public","default_language","default_currency","status","languages","currencies","active","system_default","version","created_at","updated_at") ` +
            `values (gen_random_uuid(), 't048-life', '{"en":"L"}'::jsonb, false, 'en', 'EUR', 'active', '["en"]'::jsonb, '["EUR"]'::jsonb, true, false, 1, now(), now()) returning "id"`,
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
        status: 'draft',
        name: { en: 'T048' },
        description: { en: 'fixture' },
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
        isPublic: false,
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
