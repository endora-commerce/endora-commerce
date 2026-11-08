import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { LockMode } from '@mikro-orm/core';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../helpers/package-entities.js';
import { overrideAssetSetting, useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import { forgetAssets, testRetentionSweeper } from '../../helpers/asset-replace-fixtures.js';
import { runAssetRetentionSweepTick } from '../../../../packages/modules/assets_library/src/backend/workers/retention-sweep-worker.js';

/**
 * `specs/156-asset-stable-url/` T041 — the retention sweep's previous-version
 * pass and its cleanup pass (contracts/storage-and-retention.md §4; FR-022,
 * owner rulings P1 and P3, research R-21). Every sweep runs with an explicit
 * `now`; every row and file is this run's own.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

describe('retention sweep — previous versions and the cleanup ledger (feature 156)', () => {
  let h: BackendServerHandle;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  let restoreRetention: () => Promise<void>;
  const created: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
    restoreRetention = await overrideAssetSetting(h, 'assets.soft_delete_retention_days', 10);
  }, 120_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await forgetAssets(h, created);
    await h.em().getConnection().execute(`delete from asset_object_cleanups where locator like 'as156/%'`);
    await restoreRetention();
    await store.undo();
    await teardownBackendServer(h);
  });

  async function writeObject(locator: string, text: string): Promise<string> {
    const abs = join(store.baseDir, locator);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, text);
    return abs;
  }

  async function exists(abs: string): Promise<boolean> {
    try {
      await access(abs);
      return true;
    } catch {
      return false;
    }
  }

  /** A live asset with a stable file and a previous version replaced `replacedDaysAgo` days before `now`. */
  async function forgeWithPrevious(
    now: Date,
    replacedDaysAgo: number,
    options: { storageBackend?: 'local' | 'legacy'; previousStorageLocator?: string } = {},
  ) {
    const id = randomUUID();
    const stable = `as156/${id.slice(0, 2)}/${id}.pdf`;
    const previous = `as156/${id.slice(0, 2)}/${id}.prev-${randomUUID().replace(/-/g, '')}.pdf`;
    const stableAbs = await writeObject(stable, 'current');
    const previousAbs = await writeObject(previous, 'previous');
    const em = h.em();
    em.create(Asset, {
      id,
      kind: 'pdf',
      filename: `as156-${id.slice(0, 8)}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: '7',
      storageUrl: `/assets/file/${id}`,
      storageLocator: stable,
      storageBackend: options.storageBackend ?? 'local',
      visibility: 'public',
      previousStorageLocator: options.previousStorageLocator ?? previous,
      previousFilename: `as156-${id.slice(0, 8)}-old.pdf`,
      previousMimeType: 'application/pdf',
      previousMimeTypeOverridden: false,
      previousKind: 'pdf',
      previousSizeBytes: '8',
      previousContentVersion: 'a1b2c3d4e5f6',
      previousReplacedAt: new Date(now.getTime() - replacedDaysAgo * DAY_MS),
      previousReplacedBy: null,
    });
    await em.flush();
    created.push(id);
    return { id, stable, previous, stableAbs, previousAbs, replacedAt: new Date(now.getTime() - replacedDaysAgo * DAY_MS) };
  }

  async function row(id: string) {
    return h.em().fork().findOneOrFail(Asset, { id });
  }

  async function entriesFor(locator: string) {
    return h
      .em()
      .getConnection()
      .execute<Array<{ reason: string; attempts: number }>>(
        `select reason, attempts from asset_object_cleanups where locator = ?`,
        [locator],
      );
  }

  /** Wraps the local adapter's delete: records the row as it stands, and can be told to fail. */
  function wrapDeletes(options: { failFor?: string; observeAsset?: string } = {}) {
    const adapters = h.assetsLibrary.adapters;
    const real = adapters.getForBackend.bind(adapters);
    const observed: Array<{ locator: string; previousStorageLocator: string | null | undefined }> = [];
    vi.spyOn(adapters, 'getForBackend').mockImplementation((async (code: 'local') => {
      const adapter = await real(code);
      return new Proxy(adapter, {
        get(target, prop, receiver) {
          if (prop === 'delete') {
            return async (input: { locator: string }) => {
              if (options.observeAsset) {
                const seen = await h.em().fork().findOne(Asset, { id: options.observeAsset });
                observed.push({ locator: input.locator, previousStorageLocator: seen?.previousStorageLocator });
              }
              if (input.locator === options.failFor) throw new Error('simulated delete failure');
              return (target as { delete: (i: unknown) => Promise<void> }).delete(input);
            };
          }
          const value = Reflect.get(target, prop, receiver) as unknown;
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
    }) as never);
    return observed;
  }

  it('purges a due previous version — columns cleared before the object is deleted — and keeps a younger one', async () => {
    const now = new Date();
    const due = await forgeWithPrevious(now, 20);
    const young = await forgeWithPrevious(now, 5);
    const observed = wrapDeletes({ observeAsset: due.id });

    const result = await h.assetsLibrary.sweeper.sweep(now);
    expect(result.previousPurged).toBeGreaterThanOrEqual(1);

    const deleteOfPrevious = observed.find((o) => o.locator === due.previous);
    expect(deleteOfPrevious).toBeDefined();
    expect(deleteOfPrevious!.previousStorageLocator ?? null).toBeNull();
    const after = await row(due.id);
    expect(after.previousStorageLocator ?? null).toBeNull();
    expect(after.previousFilename ?? null).toBeNull();
    expect(after.previousReplacedAt ?? null).toBeNull();
    expect(await exists(due.previousAbs)).toBe(false);
    expect(await exists(due.stableAbs)).toBe(true);
    expect(await entriesFor(due.previous)).toEqual([]);

    expect((await row(young.id)).previousStorageLocator).toBe(young.previous);
    expect(await exists(young.previousAbs)).toBe(true);
  });

  it('reads the retention when the sweep runs: shortening the setting makes a younger previous version due', async () => {
    const now = new Date();
    const asset = await forgeWithPrevious(now, 5);
    await h.assetsLibrary.sweeper.sweep(now);
    expect((await row(asset.id)).previousStorageLocator).toBe(asset.previous);

    const restore = await overrideAssetSetting(h, 'assets.soft_delete_retention_days', 3);
    try {
      await h.assetsLibrary.sweeper.sweep(now);
      expect((await row(asset.id)).previousStorageLocator ?? null).toBeNull();
      expect(await exists(asset.previousAbs)).toBe(false);
    } finally {
      await restore();
    }
  });

  it('leaves a purge entry when the previous file cannot be deleted, and the cleanup pass finishes it a day later', async () => {
    const now = new Date();
    const asset = await forgeWithPrevious(now, 20);
    wrapDeletes({ failFor: asset.previous });
    await h.assetsLibrary.sweeper.sweep(now);
    expect((await row(asset.id)).previousStorageLocator ?? null).toBeNull();
    expect(await exists(asset.previousAbs)).toBe(true);
    expect((await entriesFor(asset.previous)).map((e) => e.reason)).toEqual(['purge']);

    vi.restoreAllMocks();
    const later = await h.assetsLibrary.sweeper.sweep(new Date(now.getTime() + 25 * HOUR_MS));
    expect(later.cleanupsDone).toBeGreaterThanOrEqual(1);
    expect(await exists(asset.previousAbs)).toBe(false);
    expect(await entriesFor(asset.previous)).toEqual([]);
  });

  it('skips a row another transaction holds, leaving its previous version intact', async () => {
    const now = new Date();
    const asset = await forgeWithPrevious(now, 20);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let lockTaken!: () => void;
    const locked = new Promise<void>((resolve) => {
      lockTaken = resolve;
    });
    const holder = h
      .em()
      .fork()
      .transactional(async (tx) => {
        await tx.findOne(Asset, { id: asset.id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        lockTaken();
        await gate;
      });
    await locked;
    try {
      await h.assetsLibrary.sweeper.sweep(now);
    } finally {
      release();
      await holder;
    }
    expect((await row(asset.id)).previousStorageLocator).toBe(asset.previous);
    expect(await exists(asset.previousAbs)).toBe(true);
  });

  it('re-checks under the lock: a restore committed between select and claim is not purged', async () => {
    const now = new Date();
    const asset = await forgeWithPrevious(now, 20);
    const sweeper = testRetentionSweeper(h, {
      beforeClaim: async (id) => {
        if (id !== asset.id) return;
        // What a restore commits: a fresh replaced-at for the demoted file.
        await h
          .em()
          .getConnection()
          .execute(`update assets set previous_replaced_at = ? where id = ?`, [now, asset.id]);
      },
    });
    const result = await sweeper.sweep(now);
    expect(result.skippedNotDue).toBeGreaterThanOrEqual(1);
    expect((await row(asset.id)).previousStorageLocator).toBe(asset.previous);
    expect(await exists(asset.previousAbs)).toBe(true);
  });

  it('cleanup pass: deletes old entries and their objects, leaves young and referenced ones, clears missing ones', async () => {
    const now = new Date();
    const conn = h.em().getConnection();
    const old = new Date(now.getTime() - 2 * DAY_MS);
    const young = new Date(now.getTime() - HOUR_MS);
    const live = await forgeWithPrevious(now, 1);

    const orphan = `as156/${randomUUID()}.stage-${randomUUID().replace(/-/g, '')}.pdf`;
    const orphanAbs = await writeObject(orphan, 'orphan');
    const fresh = `as156/${randomUUID()}.stage-${randomUUID().replace(/-/g, '')}.pdf`;
    const freshAbs = await writeObject(fresh, 'fresh');
    const missing = `as156/${randomUUID()}.prev-${randomUUID().replace(/-/g, '')}.pdf`;
    const insert = (locator: string, reason: string, at: Date) =>
      conn.execute(
        `insert into asset_object_cleanups (id, storage_backend, locator, reason, recorded_at) values (?, 'local', ?, ?, ?)`,
        [randomUUID(), locator, reason, at],
      );
    await insert(orphan, 'staging', old);
    await insert(fresh, 'staging', young);
    await insert(live.stable, 'superseded', old);
    await insert(live.previous, 'superseded', old);
    await insert(missing, 'previous', old);

    await h.assetsLibrary.sweeper.sweep(now);

    expect(await exists(orphanAbs)).toBe(false);
    expect(await entriesFor(orphan)).toEqual([]);
    expect(await exists(freshAbs)).toBe(true);
    expect(await entriesFor(fresh)).toHaveLength(1);
    expect(await exists(live.stableAbs)).toBe(true);
    expect(await exists(live.previousAbs)).toBe(true);
    expect(await entriesFor(live.stable)).toHaveLength(1);
    expect(await entriesFor(missing)).toEqual([]);
  });

  // Issue #914 — pass 1 never purges a legacy row, so it must not select one:
  // the probe would answer yes on every tick, and a batch of them would hide
  // the rows that really are due.
  it('does not let rows it skips (legacy, no previous locator) fill pass 1`s batch: a due previous version behind them is purged', async () => {
    const now = new Date();
    const legacy = await forgeWithPrevious(now, 4000, { storageBackend: 'legacy' });
    const noLocator = await forgeWithPrevious(now, 4000, { previousStorageLocator: '' });
    const due = await forgeWithPrevious(now, 3999);

    const result = await testRetentionSweeper(h, { batchSize: 2 }).sweep(now);

    expect(result.previousPurged).toBe(1);
    expect((await row(due.id)).previousStorageLocator ?? null).toBeNull();
    expect(await exists(due.previousAbs)).toBe(false);
    expect((await row(legacy.id)).previousStorageLocator).toBe(legacy.previous);
    expect(await exists(legacy.previousAbs)).toBe(true);
    expect((await row(noLocator.id)).previousReplacedAt).toEqual(noLocator.replacedAt);
  });

  it('hasDue says no when the only previous version past the cutoff is a legacy row pass 1 would skip', async () => {
    const now = new Date();
    const legacy = await forgeWithPrevious(now, 3000, { storageBackend: 'legacy' });
    // A `now` at which nothing but this row is past any pass's cutoff.
    const then = new Date(legacy.replacedAt.getTime() + 20 * DAY_MS);
    const parked = await h
      .em()
      .getConnection()
      .execute<Array<{ n: string }>>(`select count(*) as n from assets where deleted_at is not null and pending_cleanup = true`);
    expect(Number(parked[0]!.n), 'a parked soft-deleted asset answers pass 3 at any time').toBe(0);

    expect(await h.assetsLibrary.sweeper.hasDue(then)).toBe(false);
    expect((await h.assetsLibrary.sweeper.sweep(then)).previousPurged).toBe(0);
    expect((await row(legacy.id)).previousStorageLocator).toBe(legacy.previous);
  });

  it('runs a tick outside any tenant context, and hasDue says yes with one due row', async () => {
    const now = new Date();
    const asset = await forgeWithPrevious(now, 20);
    expect(await h.assetsLibrary.sweeper.hasDue(now)).toBe(true);
    const lines: Array<Record<string, unknown>> = [];
    const log = {
      info: (obj: Record<string, unknown>) => {
        lines.push(obj);
      },
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    await runAssetRetentionSweepTick({
      sweeper: testRetentionSweeper(h, { log }),
      log: log as never,
      now: () => now,
    });
    expect(log.warn).not.toHaveBeenCalled();
    expect(lines.some((l) => l.event === 'assets_library.retention.sweep')).toBe(true);
    expect((await row(asset.id)).previousStorageLocator ?? null).toBeNull();
  });
});
