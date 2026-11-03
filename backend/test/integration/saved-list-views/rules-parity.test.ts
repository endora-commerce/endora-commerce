import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OrderListViewService } from '../../../../packages/modules/orders/src/backend/services/order-list-view-service.js';
import { ProductListViewService } from '../../../../packages/modules/catalog/src/backend/services/product-list-view-service.js';
import { QuoteRequestListViewService } from '../../../../packages/modules/quote_requests/src/backend/services/quote-request-list-view-service.js';
import { ReturnListViewService } from '../../../../packages/modules/returns/src/backend/services/return-list-view-service.js';
import { TaskListViewService } from '../../../../packages/modules/tasks/src/backend/services/saved-view-service.js';
import { savedViewActor as orderSavedViewActor } from '../../../../packages/modules/orders/src/backend/saved-view-actor.js';
import { savedViewActor as productSavedViewActor } from '../../../../packages/modules/catalog/src/backend/saved-view-actor.js';
import { savedViewActor as quoteRequestSavedViewActor } from '../../../../packages/modules/quote_requests/src/backend/saved-view-actor.js';
import { savedViewActor as returnSavedViewActor } from '../../../../packages/modules/returns/src/backend/saved-view-actor.js';
import { savedViewActor as taskSavedViewActor } from '../../../../packages/modules/tasks/src/backend/saved-view-actor.js';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext, type TenantContext } from '../../../src/tenancy/tenant-context.js';

/**
 * `specs/147-saved-views/` — one set of saved-view rules, judged the same way
 * for every list that has saved views (FR-013, FR-014, FR-022; research R-5,
 * R-12, R-18).
 *
 * Each list contributes one adapter row: how to build its service over the
 * harness's EntityManager and how to write a row **around** the service (for
 * the legacy-duplicate case, which the service itself would refuse). The
 * scenario table below then runs unchanged against each row, so a list whose
 * service drifts from the others fails here rather than in review.
 *
 * Every name carries a per-run suffix and every owner id is fresh, so rows left
 * by another file in the shared database cannot redden an assertion here.
 */

interface Actor {
  adminUserId: string;
  isPlatformAdmin: boolean;
}

interface ViewDto {
  id: string;
  name: string;
  shared: boolean;
  ownerAdminUserId: string;
  ownedByCaller: boolean;
  canModify: boolean;
}

interface CreateInput {
  name: string;
  shared: boolean;
  filters: Record<string, unknown>;
  sort?: { field: string; dir: 'asc' | 'desc' };
  visibleColumns?: string[] | null;
}

interface SavedViewServiceUnderTest {
  listFor(actor: Actor): Promise<ViewDto[]>;
  create(actor: Actor, input: CreateInput): Promise<ViewDto>;
  update(id: string, actor: Actor, patch: Partial<CreateInput>): Promise<ViewDto>;
  remove(id: string, actor: Actor): Promise<void>;
}

interface LogRecord {
  obj: Record<string, unknown>;
  msg: string;
}

interface SpyLogger {
  records: LogRecord[];
  info(obj: object, msg: string): void;
}

interface ListAdapter {
  label: string;
  /** The table the service writes, also the `list` field of its log record. */
  table: string;
  /** The list's own conflict code. */
  conflictCode: string;
  /**
   * Whether the table can hold two rows of one owner whose names share a key.
   * `orders`' can — rows written before the rule are kept (research R-5) — so
   * S8 proves they are left alone. The new tables carry a unique index on
   * `(owner_admin_user_id, lower(name))`, so for them S8 proves the schema
   * itself refuses the duplicate instead.
   */
  holdsLegacyDuplicates: boolean;
  /**
   * The unique index S8 expects the schema to answer with; `<table>_owner_name_key_uq`
   * unless named. Tasks' migration (`specs/165-task-management/`) named it
   * `task_list_saved_views_owner_name_unique` before it joined this table.
   */
  uniqueIndex?: string;
  make(emFactory: () => EntityManager, log: SpyLogger): SavedViewServiceUnderTest;
  /**
   * The list's route-side actor derivation: who is asking, read from the
   * request's ambient tenant context. Every list must derive
   * "platform admin (for saved views)" the same way (A1–A5 below).
   */
  actor(): Actor;
  /** Insert a row without going through the service's rules. */
  seedRaw(em: EntityManager, row: { ownerAdminUserId: string; name: string; shared: boolean }): Promise<string>;
}

const ADAPTERS: ListAdapter[] = [
  {
    label: 'orders',
    table: 'order_list_saved_views',
    conflictCode: 'ORDER_SAVED_VIEW_NAME_TAKEN',
    holdsLegacyDuplicates: true,
    // The cast is deliberate and must stay this narrow: the lists' input
    // shapes differ (orders requires `sort`, products accept none), so no one
    // type fits every service exactly. The scenarios below are what hold the
    // four methods to one shape — do not widen the cast to hide a drift.
    make: (emFactory, log) =>
      new OrderListViewService(emFactory, log) as unknown as SavedViewServiceUnderTest,
    actor: orderSavedViewActor,
    async seedRaw(em, row) {
      const id = randomUUID();
      await em.execute(
        `insert into order_list_saved_views
           (id, owner_admin_user_id, name, shared, filters, sort, visible_columns, created_at, updated_at)
         values (?, ?, ?, ?, '{}'::jsonb, '{"field":"placedAt","dir":"desc"}'::jsonb, null, now(), now())`,
        [id, row.ownerAdminUserId, row.name, row.shared],
      );
      return id;
    },
  },
  {
    label: 'catalog',
    table: 'product_list_saved_views',
    conflictCode: 'PRODUCT_SAVED_VIEW_NAME_TAKEN',
    holdsLegacyDuplicates: false,
    // Same narrow cast as orders': the product list stores neither `sort` nor
    // `visibleColumns`, so the shared `input()` carries keys it ignores.
    make: (emFactory, log) =>
      new ProductListViewService(emFactory, log) as unknown as SavedViewServiceUnderTest,
    actor: productSavedViewActor,
    async seedRaw(em, row) {
      const id = randomUUID();
      await em.execute(
        `insert into product_list_saved_views
           (id, owner_admin_user_id, name, shared, filters, created_at, updated_at)
         values (?, ?, ?, ?, '{}'::jsonb, now(), now())`,
        [id, row.ownerAdminUserId, row.name, row.shared],
      );
      return id;
    },
  },
  {
    label: 'quote_requests',
    table: 'quote_request_list_saved_views',
    conflictCode: 'RFQ_SAVED_VIEW_NAME_TAKEN',
    holdsLegacyDuplicates: false,
    // Same narrow cast as the others': the quote-request list's `sort` and
    // `visibleColumns` are optional, which no one input type shares exactly.
    make: (emFactory, log) =>
      new QuoteRequestListViewService(emFactory, log) as unknown as SavedViewServiceUnderTest,
    actor: quoteRequestSavedViewActor,
    async seedRaw(em, row) {
      const id = randomUUID();
      await em.execute(
        `insert into quote_request_list_saved_views
           (id, owner_admin_user_id, name, shared, filters, sort, visible_columns, created_at, updated_at)
         values (?, ?, ?, ?, '{}'::jsonb, null, null, now(), now())`,
        [id, row.ownerAdminUserId, row.name, row.shared],
      );
      return id;
    },
  },
  {
    // Issue #312: the Returns list. Its table predates the rules, as the order
    // list's does, so it carries no unique index and keeps rows saved before
    // them — names, duplicates and all.
    label: 'returns',
    table: 'return_list_saved_views',
    conflictCode: 'RETURN_SAVED_VIEW_NAME_TAKEN',
    holdsLegacyDuplicates: true,
    // Same narrow cast as orders': the return list requires `sort`.
    make: (emFactory, log) =>
      new ReturnListViewService(emFactory, log) as unknown as SavedViewServiceUnderTest,
    actor: returnSavedViewActor,
    async seedRaw(em, row) {
      const id = randomUUID();
      await em.execute(
        `insert into return_list_saved_views
           (id, owner_admin_user_id, name, shared, filters, sort, visible_columns, created_at, updated_at)
         values (?, ?, ?, ?, '{}'::jsonb, '{"field":"submittedAt","dir":"desc"}'::jsonb, null, now(), now())`,
        [id, row.ownerAdminUserId, row.name, row.shared],
      );
      return id;
    },
  },
  {
    // `specs/165-task-management/` R-13: the Tasks list and board, on the same rules.
    label: 'tasks',
    table: 'task_list_saved_views',
    conflictCode: 'TASK_VIEW_NAME_TAKEN',
    holdsLegacyDuplicates: false,
    uniqueIndex: 'task_list_saved_views_owner_name_unique',
    // Same narrow cast as the others': the Tasks list's `sort` and
    // `visibleColumns` are optional, which no one input type shares exactly.
    make: (emFactory, log) => new TaskListViewService(emFactory, log) as unknown as SavedViewServiceUnderTest,
    actor: taskSavedViewActor,
    async seedRaw(em, row) {
      const id = randomUUID();
      await em.execute(
        `insert into task_list_saved_views
           (id, owner_admin_user_id, name, shared, filters, sort, visible_columns, created_at, updated_at)
         values (?, ?, ?, ?, '{}'::jsonb, null, null, now(), now())`,
        [id, row.ownerAdminUserId, row.name, row.shared],
      );
      return id;
    },
  },
];

function spyLogger(): SpyLogger {
  const records: LogRecord[] = [];
  return {
    records,
    info(obj: object, msg: string): void {
      records.push({ obj: obj as Record<string, unknown>, msg });
    },
  };
}

function statusOf(err: unknown): number | undefined {
  return (err as { statusCode?: number }).statusCode;
}

function codeOf(err: unknown): string | undefined {
  return (err as { code?: string }).code;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to be refused');
}

describe('saved list views — one rule set for every list (spec 147)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe.each(ADAPTERS)('$label', (adapter) => {
    let log: SpyLogger;
    let svc: SavedViewServiceUnderTest;
    const owner: Actor = { adminUserId: randomUUID(), isPlatformAdmin: false };
    const colleague: Actor = { adminUserId: randomUUID(), isPlatformAdmin: false };
    const platformAdmin: Actor = { adminUserId: randomUUID(), isPlatformAdmin: true };
    const input = (name: string, shared = false): CreateInput => ({
      name,
      shared,
      filters: {},
      sort: { field: 'placedAt', dir: 'desc' },
    });

    beforeAll(() => {
      log = spyLogger();
      svc = adapter.make(() => h.em(), log);
    });

    it('S1 lists the caller\'s own views and every shared view, ordered by name', async () => {
      const mineB = await svc.create(owner, input(`S1 b ${run}`));
      const mineA = await svc.create(owner, input(`S1 a ${run}`));
      const theirsShared = await svc.create(colleague, input(`S1 c ${run}`, true));
      const theirsPrivate = await svc.create(colleague, input(`S1 d ${run}`));

      const ids = (await svc.listFor(owner)).map((v) => v.id);
      expect(ids).toContain(mineA.id);
      expect(ids).toContain(mineB.id);
      expect(ids).toContain(theirsShared.id);
      expect(ids).not.toContain(theirsPrivate.id);
      expect(ids.indexOf(mineA.id)).toBeLessThan(ids.indexOf(mineB.id));
      expect(ids.indexOf(mineB.id)).toBeLessThan(ids.indexOf(theirsShared.id));
    });

    it('S2 treats another admin\'s private view as absent', async () => {
      const priv = await svc.create(colleague, input(`S2 ${run}`));
      expect((await svc.listFor(owner)).some((v) => v.id === priv.id)).toBe(false);
      expect(statusOf(await rejection(svc.update(priv.id, owner, { shared: true })))).toBe(404);
      expect(statusOf(await rejection(svc.remove(priv.id, owner)))).toBe(404);
      // A platform admin does not see into another admin's private view either.
      expect(statusOf(await rejection(svc.remove(priv.id, platformAdmin)))).toBe(404);
    });

    it('S3 refuses a shared view to a caller who is neither its owner nor a platform admin', async () => {
      const shared = await svc.create(colleague, input(`S3 ${run}`, true));
      expect(statusOf(await rejection(svc.update(shared.id, owner, { shared: false })))).toBe(403);
      expect(statusOf(await rejection(svc.remove(shared.id, owner)))).toBe(403);
    });

    it('S4 lets a platform admin update and remove another admin\'s shared view', async () => {
      const shared = await svc.create(colleague, input(`S4 ${run}`, true));
      const updated = await svc.update(shared.id, platformAdmin, { name: `S4 renamed ${run}` });
      expect(updated.name).toBe(`S4 renamed ${run}`);
      expect(updated.ownerAdminUserId).toBe(colleague.adminUserId);
      await svc.remove(shared.id, platformAdmin);
      expect((await svc.listFor(colleague)).some((v) => v.id === shared.id)).toBe(false);
    });

    it('S5 computes ownedByCaller and canModify per caller', async () => {
      const shared = await svc.create(colleague, input(`S5 shared ${run}`, true));
      const priv = await svc.create(colleague, input(`S5 private ${run}`));

      const forOwner = await svc.listFor(colleague);
      expect(forOwner.find((v) => v.id === shared.id)).toMatchObject({ ownedByCaller: true, canModify: true });
      expect(forOwner.find((v) => v.id === priv.id)).toMatchObject({ ownedByCaller: true, canModify: true });

      const forOther = await svc.listFor(owner);
      expect(forOther.find((v) => v.id === shared.id)).toMatchObject({ ownedByCaller: false, canModify: false });

      const forPlatform = await svc.listFor(platformAdmin);
      expect(forPlatform.find((v) => v.id === shared.id)).toMatchObject({ ownedByCaller: false, canModify: true });
      expect(forPlatform.some((v) => v.id === priv.id)).toBe(false);

      // The write's own answer carries the flags too.
      expect(shared).toMatchObject({ ownedByCaller: true, canModify: true });
    });

    it('S6 refuses a create whose key the same owner uses; another owner may use it', async () => {
      await svc.create(owner, input(`S6 Unpaid ${run}`));
      const err = await rejection(svc.create(owner, input(`  s6 UNPAID ${run} `, true)));
      expect(statusOf(err)).toBe(409);
      expect(codeOf(err)).toBe(adapter.conflictCode);

      const other = await svc.create(colleague, input(`S6 unpaid ${run}`));
      expect(other.ownerAdminUserId).toBe(colleague.adminUserId);
    });

    it('S7 refuses a rename to a taken key, judged against the view owner\'s names', async () => {
      await svc.create(owner, input(`S7 taken ${run}`));
      const mine = await svc.create(owner, input(`S7 mine ${run}`));
      const err = await rejection(svc.update(mine.id, owner, { name: ` s7 TAKEN ${run}` }));
      expect(statusOf(err)).toBe(409);
      expect(codeOf(err)).toBe(adapter.conflictCode);

      // A platform admin renaming the owner's shared view hits the owner's key…
      const shared = await svc.create(owner, input(`S7 shared ${run}`, true));
      const byAdmin = await rejection(svc.update(shared.id, platformAdmin, { name: `S7 Taken ${run}` }));
      expect(statusOf(byAdmin)).toBe(409);
      // …and not its own: the platform admin's own view of that key is no conflict.
      await svc.create(platformAdmin, input(`S7 admin own ${run}`));
      const renamed = await svc.update(shared.id, platformAdmin, { name: `S7 admin own ${run}` });
      expect(renamed.name).toBe(`S7 admin own ${run}`);
    });

    it.runIf(!adapter.holdsLegacyDuplicates)('S8 refuses a duplicate key at the schema, around the service', async () => {
      const em = h.em();
      await adapter.seedRaw(em, { ownerAdminUserId: owner.adminUserId, name: `S8 unique ${run}`, shared: false });
      await expect(
        adapter.seedRaw(em, { ownerAdminUserId: owner.adminUserId, name: `s8 UNIQUE ${run}`, shared: false }),
      ).rejects.toThrow(adapter.uniqueIndex ?? `${adapter.table}_owner_name_key_uq`);
    });

    it.runIf(adapter.holdsLegacyDuplicates)('S8 leaves a pre-existing duplicate alone when only `shared` changes', async () => {
      const em = h.em();
      const a = await adapter.seedRaw(em, { ownerAdminUserId: owner.adminUserId, name: `S8 dup ${run}`, shared: false });
      await adapter.seedRaw(em, { ownerAdminUserId: owner.adminUserId, name: `s8 DUP ${run}`, shared: false });
      const updated = await svc.update(a, owner, { shared: true });
      expect(updated.shared).toBe(true);
      // Re-sending the unchanged name is not a key change either.
      const same = await svc.update(a, owner, { name: `S8 dup ${run}` });
      expect(same.name).toBe(`S8 dup ${run}`);
    });

    it('S9 stores names trimmed', async () => {
      const created = await svc.create(owner, input(`   S9 padded ${run}   `));
      expect(created.name).toBe(`S9 padded ${run}`);
      const rows = (await h.em().execute(`select name from ${adapter.table} where id = ?`, [created.id])) as Array<{
        name: string;
      }>;
      expect(rows[0]?.name).toBe(`S9 padded ${run}`);
      const renamed = await svc.update(created.id, owner, { name: `  S9 renamed ${run} ` });
      expect(renamed.name).toBe(`S9 renamed ${run}`);
    });

    it('S10 lets exactly one of two concurrent creates with one key through', async () => {
      const racer: Actor = { adminUserId: randomUUID(), isPlatformAdmin: false };
      const results = await Promise.allSettled([
        svc.create(racer, input(`S10 race ${run}`)),
        svc.create(racer, input(` s10 RACE ${run}`)),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(statusOf(rejected[0]!.reason)).toBe(409);
      expect(codeOf(rejected[0]!.reason)).toBe(adapter.conflictCode);
      const rows = (await h
        .em()
        .execute(`select count(*)::int as n from ${adapter.table} where owner_admin_user_id = ?`, [
          racer.adminUserId,
        ])) as Array<{ n: number }>;
      expect(rows[0]?.n).toBe(1);
    });

    it('S10b serialises a platform admin\'s rename with the owner\'s own create on the owner\'s lock', async () => {
      const racer: Actor = { adminUserId: randomUUID(), isPlatformAdmin: false };
      const shared = await svc.create(racer, input(`S10b before ${run}`, true));
      const key = `S10b key ${run}`;
      const results = await Promise.allSettled([
        svc.update(shared.id, platformAdmin, { name: key }),
        svc.create(racer, input(key.toUpperCase())),
      ]);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(statusOf(rejected[0]!.reason)).toBe(409);
      const rows = (await h
        .em()
        .execute(
          `select count(*)::int as n from ${adapter.table} where owner_admin_user_id = ? and lower(btrim(name)) = lower(?)`,
          [racer.adminUserId, key],
        )) as Array<{ n: number }>;
      expect(rows[0]?.n).toBe(1);
    });

    it('S12 logs one record when a platform admin modifies or deletes another owner\'s view, none for the owner', async () => {
      const shared = await svc.create(colleague, input(`S12 ${run}`, true));
      const own = await svc.create(colleague, input(`S12 own ${run}`, true));
      log.records.length = 0;

      await svc.update(own.id, colleague, { shared: false });
      await svc.remove(own.id, colleague);
      expect(log.records).toHaveLength(0);

      // A real change: re-sending `shared: true` alone would be a no-op (S13).
      await svc.update(shared.id, platformAdmin, { name: `S12 renamed ${run}` });
      await svc.remove(shared.id, platformAdmin);
      expect(log.records.map((r) => r.obj)).toEqual([
        {
          event: 'saved_view.updated',
          list: adapter.table,
          viewId: shared.id,
          ownerAdminUserId: colleague.adminUserId,
          actorAdminUserId: platformAdmin.adminUserId,
        },
        {
          event: 'saved_view.deleted',
          list: adapter.table,
          viewId: shared.id,
          ownerAdminUserId: colleague.adminUserId,
          actorAdminUserId: platformAdmin.adminUserId,
        },
      ]);
    });

    it('S13 treats a PATCH that changes nothing as a read: no write, no log, still authorised', async () => {
      const filters = { status: 'open', q: `s13 ${run}` };
      const created = await svc.create(colleague, { ...input(`S13 ${run}`, true), filters, visibleColumns: ['number'] });
      const updatedAt = async (): Promise<string> => {
        const rows = (await h
          .em()
          .execute(`select updated_at::text as at from ${adapter.table} where id = ?`, [created.id])) as Array<{
          at: string;
        }>;
        return rows[0]!.at;
      };
      const before = await updatedAt();
      log.records.length = 0;

      // An empty body, and every value re-sent as stored (the name padded,
      // the filters' keys reordered) — answered with the current view.
      expect(await svc.update(created.id, platformAdmin, {})).toEqual({
        ...created,
        ownedByCaller: false,
        canModify: true,
      });
      const same = await svc.update(created.id, platformAdmin, {
        name: `  S13 ${run} `,
        shared: true,
        filters: { q: `s13 ${run}`, status: 'open' },
        sort: { field: 'placedAt', dir: 'desc' },
        visibleColumns: ['number'],
      });
      expect(same.name).toBe(`S13 ${run}`);
      expect(log.records).toHaveLength(0);
      expect(await updatedAt()).toBe(before);

      // Changing nothing does not skip the gate.
      expect(statusOf(await rejection(svc.update(created.id, owner, {})))).toBe(403);
      const priv = await svc.create(colleague, input(`S13 private ${run}`));
      expect(statusOf(await rejection(svc.update(priv.id, owner, {})))).toBe(404);
    });
  });

  // A1–A5 — "platform admin (for saved views)" is derived from the request's
  // tenant context, identically for every list and failing closed. The orders
  // list used to read its own admin-orders scope resolver instead and answered
  // `true` when the composition did not provide one (security review SV-1).
  describe.each(ADAPTERS)('$label actor derivation', (adapter) => {
    const adminUserId = randomUUID();
    const within = <T>(ctx: TenantContext | undefined, fn: () => T): Promise<T> =>
      ctx === undefined ? Promise.resolve().then(fn) : runWithTenantContext(ctx, async () => fn());
    const refusal = (fn: () => unknown): Promise<unknown> =>
      rejection(Promise.resolve().then(fn));

    it('A1 treats an admin whose context reaches every organization as a platform admin', async () => {
      const ctx = resolveTenantContext({ kind: 'admin', adminUserId }, { allowAll: true });
      expect(await within(ctx, adapter.actor)).toEqual({ adminUserId, isPlatformAdmin: true });
    });

    it('A2 does not treat a sales representative (an allowed set) as a platform admin', async () => {
      const ctx = resolveTenantContext(
        { kind: 'admin', adminUserId },
        { allowAll: false, allowedOrganizationIds: [randomUUID()] },
      );
      expect(await within(ctx, adapter.actor)).toEqual({ adminUserId, isPlatformAdmin: false });
    });

    it('A3 fails closed when nothing could say what the admin reaches (no scope port composed)', async () => {
      // The exact scope the platform's request hook builds for an admin when no
      // `adminTenantScopePort` is registered: no organization. The old orders
      // derivation answered `true` here.
      const ctx = resolveTenantContext(
        { kind: 'admin', adminUserId },
        { allowAll: false, allowedOrganizationIds: [] },
      );
      expect(await within(ctx, adapter.actor)).toEqual({ adminUserId, isPlatformAdmin: false });
    });

    it('A4 fails closed for an admin whose role could not be resolved', async () => {
      const ctx = resolveTenantContext(
        { kind: 'admin', adminUserId },
        { allowAll: true, unresolved: new Error('ADMIN_ROLE_REQUIRED') },
      );
      expect(await within(ctx, adapter.actor)).toEqual({ adminUserId, isPlatformAdmin: false });
    });

    it('A5 answers 401 when the context carries no admin actor', async () => {
      const customer = resolveTenantContext({
        kind: 'customer',
        customerAccountId: randomUUID(),
        organizationId: randomUUID(),
      });
      expect(statusOf(await within(customer, () => refusal(adapter.actor)))).toBe(401);
      expect(statusOf(await refusal(adapter.actor))).toBe(401);
    });
  });

  // S11 — a view created through one list's service is not listed by
  // another's. It runs once per ordered pair, so with one list it runs zero
  // times and starts measuring the moment a second row joins the table.
  const pairs = ADAPTERS.flatMap((a) => ADAPTERS.filter((b) => b !== a).map((b) => [a, b] as const));
  for (const [from, to] of pairs) {
    it(`S11 a view saved on ${from.label} is not listed on ${to.label}`, async () => {
      const actor: Actor = { adminUserId: randomUUID(), isPlatformAdmin: false };
      const created = await from.make(() => h.em(), spyLogger()).create(actor, {
        name: `S11 ${run}`,
        shared: true,
        filters: {},
        sort: { field: 'placedAt', dir: 'desc' },
      });
      const listed = await to.make(() => h.em(), spyLogger()).listFor(actor);
      expect(listed.some((v) => v.id === created.id)).toBe(false);
    });
  }
});
