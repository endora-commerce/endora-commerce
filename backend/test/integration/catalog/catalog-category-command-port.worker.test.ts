import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  type CatalogCategoryCommandPort,
  type CatalogCategoryReadPort,
} from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { MissingTenantContextError, withSystemScope } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { runWithoutTenantContext } from '../../../src/tenancy/tenant-context.js';

/**
 * `specs/186-aggregate-ports/` US8 (issue #1826) — a PIM-style worker
 * maintains a category tree through `catalogCategoryCommandPort` with no
 * administrator anywhere: every call runs under `withSystemScope`, so each
 * entry records the `system` actor (no administrator id) and the worker names
 * itself through `source` (D-293.6).
 *
 * The worker creates two roots and a child, moves the child under the other
 * root — the storefront navigation is told, through `category.updated.v1`, as
 * for the admin move (US8 scenario 1) — sets its thresholds, then deletes it.
 * With no tenant context at all the port refuses before anything is written
 * (FR-005).
 */

const SOURCE = 'pim.categories';

describe('catalogCategoryCommandPort from a worker (186 US8)', () => {
  let h: BackendServerHandle;
  let port: CatalogCategoryCommandPort;
  let read: CatalogCategoryReadPort;
  const stamp = randomUUID().replace(/-/g, '').slice(0, 8);
  const asWorker = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('test: PIM category sync', fn);
  const updated: string[] = [];
  let off: () => void = () => {};

  const entries = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'category', objectId }, { orderBy: { actedAt: 'asc' } });

  beforeAll(async () => {
    h = await setupBackendServer();
    port = h.container.resolve<CatalogCategoryCommandPort>('catalogCategoryCommandPort');
    read = h.container.resolve<CatalogCategoryReadPort>('catalogCategoryReadPort');
    off = h.eventBus.on('category.updated.v1' as never, (payload: unknown) => {
      updated.push((payload as { categoryId: string }).categoryId);
    });
  });

  afterAll(async () => {
    off();
    await teardownBackendServer(h);
  });

  it('builds, moves and prunes a tree with the system actor, recording its source', async () => {
    const options = { source: SOURCE };
    const rootA = await asWorker(() => port.create({ name: { en: 'Fasteners' }, slug: `w-a-${stamp}` }, options));
    const rootB = await asWorker(() => port.create({ name: { en: 'Tools' }, slug: `w-b-${stamp}` }, options));
    const child = await asWorker(() =>
      port.create({ name: { en: 'Bolts' }, slug: `w-c-${stamp}`, parentCategoryId: rootA.id, isActive: false }, options),
    );

    await asWorker(() => port.move(child.id, { parentId: rootB.id, position: 5 }, options));
    const moved = await read.findById(child.id);
    expect(moved).toMatchObject({ parentCategoryId: rootB.id, sortOrder: 5 });
    expect((await read.ancestorsOf(child.id)).map((c) => c.id)).toEqual([child.id, rootB.id]);
    // The move reached search and the storefront navigation, as the admin move does.
    expect(updated.filter((id) => id === child.id)).toHaveLength(1);

    await asWorker(() => port.setInventoryThresholds(child.id, { high: 40, low: 4 }, options));
    expect(await read.findById(child.id)).toMatchObject({ inventoryThresholdHigh: 40, inventoryThresholdLow: 4 });

    await asWorker(() => port.delete(child.id, options));
    expect(await read.findById(child.id, { liveOnly: true })).toBeNull();

    const written = await entries(child.id);
    expect(written.map((e) => e.action)).toEqual([
      'category.create',
      'category.update',
      'category.inventory_thresholds.set',
      'category.delete',
    ]);
    for (const entry of written) {
      expect(entry.actorAdminUserId ?? null, entry.action).toBeNull();
      expect(entry.stateAfter, entry.action).toMatchObject({ source: SOURCE });
    }
  });

  it('refuses a call with no tenant context before anything is written', async () => {
    const s = `w-none-${stamp}`;
    // The harness enters a system scope around every test; step out of it.
    await runWithoutTenantContext(async () => {
      await expect(port.create({ name: { en: 'Outside any scope' }, slug: s })).rejects.toThrow(
        MissingTenantContextError,
      );
    });
    const all = await asWorker(() => read.listAll());
    expect(all.some((c) => c.slug === s)).toBe(false);
  });

  it('refuses a malformed source and an unclaimed extension before anything is written', async () => {
    const id = (await asWorker(() => port.create({ name: { en: 'Refusals' }, slug: `w-r-${stamp}` }))).id;
    const recorded = (await entries(id)).length;
    await expect(asWorker(() => port.move(id, { parentId: null }, { source: 'PIM Sync!' }))).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    await expect(
      asWorker(() => port.delete(id, { extensions: { nobody_claims_this: {} } })),
    ).rejects.toMatchObject({ statusCode: 422, code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED });
    expect(await read.findById(id, { liveOnly: true })).not.toBeNull();
    expect(await entries(id)).toHaveLength(recorded);
  });
});
