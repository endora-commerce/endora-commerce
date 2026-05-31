import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, type ChannelMemberEntityType } from '@b2b/contracts';
import { randomUUID } from 'crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { EventBus } from '../../../src/events/bus.js';
import { SalesChannelMembershipService } from '../../../src/modules/sales_channels/services/sales-channel-membership.service.js';
import { DefaultChannelReconciler } from '../../../src/modules/sales_channels/services/default-channel-reconciler.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { HttpError } from '../../../src/http/error-envelope.js';

/**
 * T043 — Bidirectional membership invariants for every bridge (FR-009 / FR-010 / FR-008).
 *
 * For each of the 9 channel-scoped entity types, exercises:
 *   1. Add membership to a non-default channel; assert it shows up
 *      from both directions (`listChannelsForEntity` and
 *      `listEntityIdsForChannel`).
 *   2. Remove membership; FR-008 refuses when it would leave the
 *      entity with zero channels; `fallbackToDefault: true` rebinds
 *      to the system-default channel in the same transaction.
 *   3. Idempotent add (re-adding is a no-op).
 *
 * The membership service operates on bridge tables via raw SQL;
 * fixtures use raw INSERTs too so the test stays decoupled from
 * each owning module's entity classes (some of which arrive in US3
 * Phase 5b — T049-T058).
 *
 * `inventory-location` is intentionally omitted: that bridge is
 * deferred until the inventory module introduces an
 * `inventory_locations` table (data-model.md note).
 */
describe('bidirectional membership: every bridge (T043)', () => {
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

  async function ensureDefault(): Promise<SalesChannel> {
    const em = db.em();
    await new DefaultChannelReconciler(() => em).run();
    return em.findOneOrFail(SalesChannel, { systemDefault: true });
  }

  async function ensureSerwisA(): Promise<SalesChannel> {
    const em = db.em();
    const existing = await em.findOne(SalesChannel, { code: 't043-serwis-a' });
    if (existing) return existing;
    const channel = em.create(SalesChannel, {
      code: 't043-serwis-a',
      name: { en: 'Serwis A' },
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
    return channel;
  }

  /**
   * Per-entity-type fixture inserter. Uses raw SQL through the test EM's
   * connection so fixtures land in the test transaction. Each function
   * inserts one row and returns its id.
   */
  const FIXTURE_INSERTERS: Record<ChannelMemberEntityType, () => Promise<string>> = {
    product: async () => insertProduct(),
    category: async () => insertCategory(),
    'payment-method': async () => insertPaymentMethod(),
    'delivery-method': async () => insertDeliveryMethod(),
    organization: async () => insertOrganization(),
    tax: async () => insertTax(),
    customer: async () => insertCustomerAccount(),
    promotion: async () => insertPromotion(),
    'cms-page': async () => insertCmsPage(),
  };

  async function rawExec(sql: string, params: unknown[] = []): Promise<void> {
    const em = db.em();
    await em
      .getConnection()
      .execute(sql, params, 'run', em.getTransactionContext());
  }

  async function insertProduct(): Promise<string> {
    const id = randomUUID();
    const slug = `t043-prod-${id.slice(0, 8)}`;
    await rawExec(
      `insert into "products" ("id","sku","slug","type","status","name","description","visibility",` +
        `"attribute_values","allowed_organization_ids","created_at","updated_at") values ` +
        `(?, ?, ?, 'simple', 'draft', ?::jsonb, ?::jsonb, 'public', '{}'::jsonb, '[]'::jsonb, now(), now())`,
      [id, `T043-${id.slice(0, 8)}`, slug, '{"en":"P"}', '{"en":"P"}'],
    );
    return id;
  }

  async function insertCategory(): Promise<string> {
    const id = randomUUID();
    await rawExec(
      `insert into "categories" ("id","name","slug","sort_order","created_at","updated_at") ` +
        `values (?, ?::jsonb, ?, 0, now(), now())`,
      [id, '{"en":"Cat"}', `t043-cat-${id.slice(0, 8)}`],
    );
    return id;
  }

  async function insertPaymentMethod(): Promise<string> {
    const id = randomUUID();
    await rawExec(
      `insert into "payment_methods" ("id","code","name","kind","adapter",` +
        `"status_on_pending","status_on_success","status_on_failure","created_at","updated_at") ` +
        `values (?, ?, ?::jsonb, 'manual', 'manual', 'new', 'paid', 'cancelled', now(), now())`,
      [id, `t043-pm-${id.slice(0, 8)}`, '{"en":"PM"}'],
    );
    return id;
  }

  async function insertDeliveryMethod(): Promise<string> {
    const id = randomUUID();
    await rawExec(
      `insert into "delivery_methods" ("id","code","name","cost","currency","created_at","updated_at") ` +
        `values (?, ?, ?::jsonb, 0, 'PLN', now(), now())`,
      [id, `t043-dm-${id.slice(0, 8)}`, '{"en":"DM"}'],
    );
    return id;
  }

  async function insertOrganization(): Promise<string> {
    const id = randomUUID();
    await rawExec(
      `insert into "organizations" ("id","name","tax_id","status","vat_status","registered_address","created_at","updated_at") ` +
        `values (?, ?, ?, 'active', 'vat_payer', '{}'::jsonb, now(), now())`,
      [id, `T043 Org ${id.slice(0, 8)}`, `t043-tax-${id.slice(0, 8)}`],
    );
    return id;
  }

  async function insertTax(): Promise<string> {
    const id = randomUUID();
    await rawExec(
      `insert into "taxes" ("id","code","name","rate","applies_to_vat_statuses","created_at","updated_at") ` +
        `values (?, ?, 'T043 Tax', 0.23, '[]'::jsonb, now(), now())`,
      [id, `t043-tax-${id.slice(0, 8)}`],
    );
    return id;
  }

  async function insertCustomerAccount(): Promise<string> {
    const id = randomUUID();
    const orgId = await insertOrganization();
    await rawExec(
      `insert into "customer_accounts" ("id","organization_id","email","password_hash","first_name","last_name","role","created_at","updated_at") ` +
        `values (?, ?, ?, '$2b$10$x', 'T', '043', 'regular_user', now(), now())`,
      [id, orgId, `t043-${id.slice(0, 8)}@example.test`],
    );
    return id;
  }

  async function insertPromotion(): Promise<string> {
    const id = randomUUID();
    await rawExec(
      `insert into "promotions" ("id","name","kind","value","is_active","created_at","updated_at") ` +
        `values (?, 'T043 Promo', 'percent_off', 10, true, now(), now())`,
      [id],
    );
    return id;
  }

  async function insertCmsPage(): Promise<string> {
    const id = randomUUID();
    // Legacy `path`, `title`, `body` columns survive the feature-014
    // schema as NOT-NULL mirrors and must be populated until they are
    // dropped in a follow-up cleanup migration.
    await rawExec(
      `insert into "cms_pages"
         ("id","path","name","slug","status","active",
          "title","body","content","languages","version","created_at","updated_at")
       values (?, ?, ?, ?, 'draft', true,
          '{}'::jsonb, '{}'::jsonb,
          '{"schema_version":1,"languages":{}}'::jsonb, '[]'::jsonb, 1, now(), now())`,
      [id, `t043-${id.slice(0, 8)}-path`, `Page ${id.slice(0, 8)}`, `t043-${id.slice(0, 8)}`],
    );
    return id;
  }

  const ENTITY_TYPES: ChannelMemberEntityType[] = [
    'product',
    'category',
    'payment-method',
    'delivery-method',
    'organization',
    'tax',
    'customer',
    'promotion',
    'cms-page',
  ];

  it.each(ENTITY_TYPES)(
    '%s: bidirectional add/remove with FR-008 enforcement',
    async (entityType) => {
      try {
        const def = await ensureDefault();
        const serwisA = await ensureSerwisA();
        const eventBus = new EventBus();
        const svc = new SalesChannelMembershipService(() => db.em(), eventBus);

        const entityId = await FIXTURE_INSERTERS[entityType]();

        // 1. Add to serwis-a; assert visible from both sides.
        const addRes = await svc.addToChannel(serwisA.id, entityType, entityId);
        expect(addRes.changed).toBe(true);

        const fromEntitySide = await svc.listChannelsForEntity(entityType, entityId);
        expect(fromEntitySide.map((c) => c.code)).toEqual([serwisA.code]);

        const fromChannelSide = await svc.listEntityIdsForChannel(serwisA.id, entityType);
        expect(fromChannelSide.entityIds).toContain(entityId);

        // 2. Idempotent re-add.
        const addAgain = await svc.addToChannel(serwisA.id, entityType, entityId);
        expect(addAgain.changed).toBe(false);

        // 3. FR-008: remove without fallback refuses (entity has only this channel).
        let caught: unknown;
        try {
          await svc.removeFromChannel(serwisA.id, entityType, entityId);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(HttpError);
        expect((caught as HttpError).code).toBe(ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS);

        // Membership still present after the refusal.
        const stillThere = await svc.listChannelsForEntity(entityType, entityId);
        expect(stillThere.map((c) => c.code)).toEqual([serwisA.code]);

        // 4. fallbackToDefault rebinds to Default in one transaction.
        const fallback = await svc.removeFromChannel(serwisA.id, entityType, entityId, {
          fallbackToDefault: true,
        });
        expect(fallback.changed).toBe(true);
        expect(fallback.fallbackAppliedToDefault).toBe(true);

        const afterFallback = await svc.listChannelsForEntity(entityType, entityId);
        expect(afterFallback.map((c) => c.id)).toEqual([def.id]);
      } finally {
        await db.rollbackTx();
      }
    },
  );
});
