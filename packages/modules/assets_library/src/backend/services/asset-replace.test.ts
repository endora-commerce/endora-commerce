import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import {
  replaceAssetFile,
  replacementKind,
  restorePreviousVersion,
  type AssetReplaceDeps,
} from './asset-replace.js';
import { cloudContentDisposition } from './asset-urls.js';
import type { Asset } from '../entities/asset.entity.js';
import type { StageInput, StageResult } from './upload-pipeline.js';
import { BackendUnavailableError } from './storage/errors.js';

// specs/156-asset-stable-url/ T025 — the replace sequence of
// contracts/storage-and-retention.md §2 and the kind guard of research R-5,
// over fakes: every adapter, ledger, staging and transaction step lands in one
// ordered log.

const ID = 'aabbccdd-1111-2222-3333-444455556666';
const STABLE = `aa/bb/${ID}.jpg`;
const OLD_CV = 'a1b2c3d4e5f6';
const OLD_PREV = `aa/bb/${ID}.prev-${'9'.repeat(32)}.jpg`;

describe('replacementKind (research R-5)', () => {
  it.each([
    ['image', 'image/png', 'image/png', 'image'],
    ['image', undefined, 'image/svg+xml', 'image'],
    ['video', 'video/webm', 'video/webm', 'video'],
    [
      'other',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'other',
    ],
    ['certificate', 'application/pdf', 'application/pdf', 'certificate'],
  ] as const)('accepts stored %s + detected %s', (stored, detected, storedMime, result) => {
    expect(replacementKind(stored, detected, storedMime)).toBe(result);
  });

  it.each([
    ['image', undefined, 'image/png', 'image', 'other'],
    ['pdf', undefined, 'application/pdf', 'pdf', 'other'],
    [
      'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'pdf',
      'other',
    ],
    ['image', 'application/pdf', 'application/pdf', 'image', 'pdf'],
  ] as const)(
    'refuses stored %s + detected %s with 415 { currentKind, newKind }',
    (stored, detected, storedMime, currentKind, newKind) => {
      expect(() => replacementKind(stored, detected, storedMime)).toThrow(
        expect.objectContaining({
          statusCode: 415,
          code: 'ASSET_REPLACE_KIND_MISMATCH',
          details: { currentKind, newKind },
        }),
      );
    },
  );

  it('ignores an admin MIME override: the stored kind decides', () => {
    // A row whose kind is `image` and whose mimeType an admin overrode to
    // application/pdf: the guard is given the stored kind only.
    expect(replacementKind('image', 'image/png', 'image/png')).toBe('image');
    expect(() => replacementKind('image', 'application/pdf', 'application/pdf')).toThrow(
      expect.objectContaining({ code: 'ASSET_REPLACE_KIND_MISMATCH' }),
    );
  });
});

interface Harness {
  log: string[];
  deps: AssetReplaceDeps;
  locked: Asset;
  stageInputs: StageInput[];
  copies: Array<Record<string, unknown>>;
}

function row(overrides: Partial<Asset> = {}): Asset {
  return {
    id: ID,
    kind: 'image',
    filename: 'old.jpg',
    mimeType: 'image/jpeg',
    mimeTypeOverridden: false,
    sizeBytes: '100',
    visibility: 'public',
    storageBackend: 'local',
    storageLocator: STABLE,
    storageUrl: `/assets/file/${ID}`,
    contentVersion: OLD_CV,
    deletedAt: null,
    previousStorageLocator: OLD_PREV,
    previousFilename: 'older.jpg',
    previousMimeType: 'image/jpeg',
    previousMimeTypeOverridden: false,
    previousKind: 'image',
    previousSizeBytes: '90',
    previousContentVersion: '0f1e2d3c4b5a',
    previousReplacedAt: new Date('2026-10-01T00:00:00Z'),
    previousReplacedBy: null,
    ...overrides,
  } as unknown as Asset;
}

function harness(opts: {
  rowOverrides?: Partial<Asset>;
  failCopyOnto?: string;
  failCommit?: boolean;
  failDeleteOf?: string;
  staged?: StageResult;
} = {}): Harness {
  const log: string[] = [];
  const copies: Array<Record<string, unknown>> = [];
  const stageInputs: StageInput[] = [];
  // Unlocked read: public. Locked read: private (research R-18).
  const unlocked = row({ visibility: 'public', ...opts.rowOverrides });
  const locked = row({ visibility: 'private', ...opts.rowOverrides });

  const adapter = {
    code: (opts.rowOverrides?.storageBackend ?? 'local') as 'local',
    async copy(input: Record<string, unknown>) {
      log.push(`copy ${String(input.from)} -> ${String(input.to)}`);
      copies.push(input);
      if (opts.failCopyOnto !== undefined && input.to === opts.failCopyOnto) {
        throw new BackendUnavailableError('copy failed');
      }
    },
    async delete({ locator }: { locator: string }) {
      log.push(`delete ${locator}`);
      if (opts.failDeleteOf !== undefined && locator === opts.failDeleteOf) {
        throw new Error('delete failed');
      }
    },
  };

  const unlockedEm = {
    findOne: async (_e: unknown, _w: unknown, o?: { lockMode?: LockMode }) => {
      if (o?.lockMode !== undefined) throw new Error('the unlocked read took a lock');
      return unlocked;
    },
  } as unknown as EntityManager;
  const lockedEm = {
    findOne: async (_e: unknown, _w: unknown, o?: { lockMode?: LockMode }) => {
      log.push(`lock ${String(o?.lockMode === LockMode.PESSIMISTIC_WRITE)}`);
      return locked;
    },
  } as unknown as EntityManager;

  const deps: AssetReplaceDeps = {
    emFactory: () => unlockedEm,
    adapters: {
      getActive: async () => {
        throw new Error('getActive must never be called by a replace');
      },
      getForBackend: async (code: string) => {
        log.push(`adapter ${code}`);
        return adapter;
      },
    } as unknown as AssetReplaceDeps['adapters'],
    stage: async (input) => {
      stageInputs.push(input);
      for await (const _chunk of input.stream) {
        /* drain */
      }
      log.push(`put ${input.locator}`);
      return (
        opts.staged ?? { storedMime: 'image/png', detectedMime: 'image/png', sizeBytes: 200 }
      );
    },
    ledger: {
      async record(entries, em) {
        for (const e of entries) log.push(`record ${e.reason} ${e.locator}${em ? ' (tx)' : ''}`);
      },
      async clear(entries, em) {
        for (const e of entries) log.push(`clear ${e.locator}${em ? ' (tx)' : ''}`);
      },
    },
    commandBus: {
      async run(command) {
        log.push(`begin ${command.action}`);
        const out = await command.run({
          em: lockedEm,
          actor: { actorAdminUserId: 'admin-1', impersonatedCustomerAccountId: null, kind: 'admin' },
        });
        if (opts.failCommit) {
          log.push('rollback');
          throw new Error('commit failed');
        }
        log.push('commit');
        return out.result;
      },
    } as AssetReplaceDeps['commandBus'],
    random: (() => {
      let n = 0;
      return () => String((n += 1)).repeat(32).slice(0, 32);
    })(),
  };
  return { log, deps, locked, stageInputs, copies };
}

function replace(h: Harness, extra: { expectedContentVersion?: string } = {}) {
  return replaceAssetFile(h.deps, {
    assetId: ID,
    filename: 'new.png',
    declaredMime: 'image/png',
    stream: Readable.from([Buffer.from('bytes')]),
    declaredSize: 0,
    ...extra,
  });
}

const STAGE = `aa/bb/${ID}.stage-${'1'.repeat(32)}.png`;
const PREV_NEW = `aa/bb/${ID}.prev-${'2'.repeat(32)}.jpg`;

describe('replaceAssetFile — the sequence', () => {
  it('records, stages, copies under the lock, commits, then cleans up', async () => {
    const h = harness();
    await replace(h);
    expect(h.log).toEqual([
      'adapter local',
      `record staging ${STAGE}`,
      `record previous ${PREV_NEW}`,
      `put ${STAGE}`,
      'begin asset.replace',
      'lock true',
      `copy ${STABLE} -> ${PREV_NEW}`,
      `copy ${STAGE} -> ${STABLE}`,
      `clear ${PREV_NEW} (tx)`,
      `record superseded ${OLD_PREV} (tx)`,
      'commit',
      `delete ${STAGE}`,
      `clear ${STAGE}`,
      `delete ${OLD_PREV}`,
      `clear ${OLD_PREV}`,
    ]);
  });

  it('copies with a private ACL onto the previous key and the LOCKED visibility onto the stable key', async () => {
    const h = harness();
    await replace(h);
    expect(h.copies[0]).toEqual({
      from: STABLE,
      to: PREV_NEW,
      visibility: 'private',
      mimeType: 'image/jpeg',
      cacheControl: 'no-cache',
      contentDisposition: cloudContentDisposition('image/jpeg', 'old.jpg'),
    });
    expect(h.copies[1]).toEqual({
      from: STAGE,
      to: STABLE,
      visibility: 'private',
      mimeType: 'image/png',
      cacheControl: 'no-cache',
      contentDisposition: cloudContentDisposition('image/png', 'new.png'),
    });
  });

  it('updates the locked row and demotes the old file to the previous version', async () => {
    const h = harness({ rowOverrides: { mimeTypeOverridden: true } as Partial<Asset> });
    const result = await replace(h);
    expect(result).toBe(h.locked);
    expect(h.locked).toMatchObject({
      filename: 'new.png',
      mimeType: 'image/png',
      mimeTypeOverridden: false,
      kind: 'image',
      sizeBytes: '200',
      storageLocator: STABLE,
      previousStorageLocator: PREV_NEW,
      previousFilename: 'old.jpg',
      previousMimeType: 'image/jpeg',
      previousMimeTypeOverridden: true,
      previousKind: 'image',
      previousSizeBytes: '100',
      previousContentVersion: OLD_CV,
      previousReplacedBy: 'admin-1',
    });
    expect(h.locked.contentVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(h.locked.contentVersion).not.toBe(OLD_CV);
    expect(h.locked.previousReplacedAt).toBeInstanceOf(Date);
  });

  it('draws a random previous key that carries neither content version', async () => {
    const h = harness();
    delete (h.deps as { random?: unknown }).random;
    await replace(h);
    const key = h.locked.previousStorageLocator!;
    expect(key).toMatch(new RegExp(`^aa/bb/${ID}\\.prev-[0-9a-f]{32}\\.jpg$`));
    expect(key).not.toContain(OLD_CV);
    expect(key).not.toContain(h.locked.contentVersion);
  });

  it('caps an S3 replace at 5 GiB and a local one not at all', async () => {
    const s3 = harness({ rowOverrides: { storageBackend: 's3' } as Partial<Asset> });
    await replace(s3);
    expect(s3.log[0]).toBe('adapter s3');
    expect(s3.stageInputs[0]!.sizeCapBytes).toBe(5 * 1024 * 1024 * 1024);
    const local = harness();
    await replace(local);
    expect(local.stageInputs[0]!.sizeCapBytes).toBeUndefined();
    expect(local.stageInputs[0]!.visibility).toBe('private');
  });

  it('refuses a kind mismatch after staging, before any copy, and cleans both keys', async () => {
    const h = harness({
      staged: { storedMime: 'application/pdf', detectedMime: 'application/pdf', sizeBytes: 5 },
    });
    await expect(replace(h)).rejects.toMatchObject({
      statusCode: 415,
      code: 'ASSET_REPLACE_KIND_MISMATCH',
    });
    expect(h.log.some((l) => l.startsWith('copy'))).toBe(false);
    expect(h.log.some((l) => l.startsWith('begin'))).toBe(false);
    expect(h.log).toContain(`delete ${STAGE}`);
    expect(h.log).toContain(`clear ${STAGE}`);
    expect(h.log).toContain(`clear ${PREV_NEW}`);
  });
});

describe('replaceAssetFile — refusals before the storage work', () => {
  it.each([
    ['a soft-deleted asset', { deletedAt: new Date() }, 410, 'ASSET_GONE'],
    ['a legacy asset', { storageBackend: 'legacy' }, 409, 'ASSET_LEGACY_CANNOT_REPLACE'],
  ] as const)('refuses %s', async (_label, overrides, status, code) => {
    const h = harness({ rowOverrides: overrides as Partial<Asset> });
    await expect(replace(h)).rejects.toMatchObject({ statusCode: status, code });
    expect(h.log.filter((l) => !l.startsWith('adapter'))).toEqual([]);
  });
});

describe('replaceAssetFile — failures', () => {
  it('refuses a stale content version with 409 before any copy and cleans the staging and new-previous entries', async () => {
    const h = harness();
    await expect(replace(h, { expectedContentVersion: 'ffffffffffff' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ASSET_REPLACE_CONFLICT',
    });
    expect(h.log.some((l) => l.startsWith('copy'))).toBe(false);
    expect(h.log).toEqual(
      expect.arrayContaining([`delete ${STAGE}`, `clear ${STAGE}`, `delete ${PREV_NEW}`, `clear ${PREV_NEW}`]),
    );
    expect(h.log).not.toContain(`delete ${OLD_PREV}`);
    expect(h.locked.contentVersion).toBe(OLD_CV);
  });

  it('answers 503 with the generic sentence, never the adapter text, and keeps it as the cause', async () => {
    const h = harness({ failCopyOnto: STABLE });
    const error = await replace(h).catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 503, code: 'ASSET_STORAGE_UNAVAILABLE' });
    expect((error as Error).message).toBe('The file storage is unavailable. Try again later.');
    expect((error as Error).message).not.toContain('copy failed');
    expect(((error as Error & { cause?: Error }).cause as Error).message).toBe('copy failed');
  });

  it('leaves the row unchanged when the copy onto the stable key fails, and deletes both new objects', async () => {
    const h = harness({ failCopyOnto: STABLE });
    await expect(replace(h)).rejects.toMatchObject({ statusCode: 503, code: 'ASSET_STORAGE_UNAVAILABLE' });
    expect(h.locked).toMatchObject({ filename: 'old.jpg', contentVersion: OLD_CV, previousStorageLocator: OLD_PREV });
    expect(h.log).toEqual(expect.arrayContaining([`delete ${STAGE}`, `delete ${PREV_NEW}`, `clear ${PREV_NEW}`]));
    expect(h.log.filter((l) => l.startsWith('copy'))).toEqual([
      `copy ${STABLE} -> ${PREV_NEW}`,
      `copy ${STAGE} -> ${STABLE}`,
    ]);
    expect(h.log).not.toContain(`delete ${OLD_PREV}`);
  });

  it('copies the old bytes back with the locked visibility when the transaction fails after the stable copy', async () => {
    const h = harness({ failCommit: true });
    await expect(replace(h)).rejects.toThrow('commit failed');
    const compensation = h.copies[2];
    expect(compensation).toEqual({
      from: PREV_NEW,
      to: STABLE,
      visibility: 'private',
      mimeType: 'image/jpeg',
      cacheControl: 'no-cache',
      contentDisposition: cloudContentDisposition('image/jpeg', 'old.jpg'),
    });
    const after = h.log.slice(h.log.indexOf('rollback'));
    expect(after).toEqual(
      expect.arrayContaining([`copy ${PREV_NEW} -> ${STABLE}`, `delete ${PREV_NEW}`, `clear ${PREV_NEW}`]),
    );
    expect(h.log.indexOf(`copy ${PREV_NEW} -> ${STABLE}`)).toBeLessThan(h.log.indexOf(`delete ${PREV_NEW}`));
    expect(h.log).not.toContain(`delete ${OLD_PREV}`);
  });

  it('still answers success when the superseded previous object cannot be deleted, keeping its entry', async () => {
    const h = harness({ failDeleteOf: OLD_PREV });
    await expect(replace(h)).resolves.toBe(h.locked);
    expect(h.log).toContain(`delete ${OLD_PREV}`);
    expect(h.log).not.toContain(`clear ${OLD_PREV}`);
  });
});

// ---------------------------------------------------------------------------
// specs/156-asset-stable-url/ T036 — restore is a swap through the same shape
// (research R-3): both versions checked under the lock, no kind check.
// ---------------------------------------------------------------------------

const PREV_FROM_RESTORE = `aa/bb/${ID}.prev-${'1'.repeat(32)}.jpg`;
const PREVIOUS_FILE = {
  previousFilename: 'older.zip',
  previousMimeType: 'application/zip',
  previousMimeTypeOverridden: true,
  previousKind: 'other',
  previousSizeBytes: '90',
} as Partial<Asset>;

function restore(h: Harness, versions: { current?: string; previous?: string } = {}) {
  return restorePreviousVersion(h.deps, {
    assetId: ID,
    expectedContentVersion: versions.current ?? OLD_CV,
    expectedPreviousContentVersion: versions.previous ?? '0f1e2d3c4b5a',
  });
}

describe('restorePreviousVersion — the swap', () => {
  it('records the new previous key, copies under the lock, swaps, commits, then deletes the old previous object', async () => {
    const h = harness({ rowOverrides: PREVIOUS_FILE });
    await restore(h);
    expect(h.log).toEqual([
      'adapter local',
      `record previous ${PREV_FROM_RESTORE}`,
      'begin asset.restore_previous_version',
      'lock true',
      `copy ${STABLE} -> ${PREV_FROM_RESTORE}`,
      `copy ${OLD_PREV} -> ${STABLE}`,
      `clear ${PREV_FROM_RESTORE} (tx)`,
      `record superseded ${OLD_PREV} (tx)`,
      'commit',
      `delete ${OLD_PREV}`,
      `clear ${OLD_PREV}`,
    ]);
  });

  it.each(['local', 's3'] as const)(
    'copies the current file to a private previous key and the previous file onto the stable key with the locked visibility (%s)',
    async (backend) => {
      const h = harness({ rowOverrides: { ...PREVIOUS_FILE, storageBackend: backend } as Partial<Asset> });
      await restore(h);
      expect(h.copies).toEqual([
        {
          from: STABLE,
          to: PREV_FROM_RESTORE,
          visibility: 'private',
          mimeType: 'image/jpeg',
          cacheControl: 'no-cache',
          contentDisposition: cloudContentDisposition('image/jpeg', 'old.jpg'),
        },
        {
          from: OLD_PREV,
          to: STABLE,
          visibility: 'private',
          mimeType: 'application/zip',
          cacheControl: 'no-cache',
          contentDisposition: cloudContentDisposition('application/zip', 'older.zip'),
        },
      ]);
    },
  );

  it('swaps every current and previous field, performing no kind check', async () => {
    const h = harness({ rowOverrides: PREVIOUS_FILE });
    const result = await restore(h);
    expect(result).toBe(h.locked);
    expect(h.locked).toMatchObject({
      filename: 'older.zip',
      mimeType: 'application/zip',
      mimeTypeOverridden: true,
      kind: 'other',
      sizeBytes: '90',
      contentVersion: '0f1e2d3c4b5a',
      storageLocator: STABLE,
      previousStorageLocator: PREV_FROM_RESTORE,
      previousFilename: 'old.jpg',
      previousMimeType: 'image/jpeg',
      previousMimeTypeOverridden: false,
      previousKind: 'image',
      previousSizeBytes: '100',
      previousContentVersion: OLD_CV,
      previousReplacedBy: 'admin-1',
    });
    expect(h.locked.previousReplacedAt!.getTime()).toBeGreaterThan(Date.parse('2026-10-01T00:00:00Z'));
  });
});

describe('restorePreviousVersion — refusals', () => {
  it.each([
    ['a stale current version', { current: 'ffffffffffff' }],
    ['a stale previous version', { previous: 'eeeeeeeeeeee' }],
  ])('refuses %s with 409 before any copy and clears the new entry', async (_label, versions) => {
    const h = harness({ rowOverrides: PREVIOUS_FILE });
    await expect(restore(h, versions)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ASSET_REPLACE_CONFLICT',
    });
    expect(h.log.some((l) => l.startsWith('copy'))).toBe(false);
    expect(h.log).toEqual(
      expect.arrayContaining([`delete ${PREV_FROM_RESTORE}`, `clear ${PREV_FROM_RESTORE}`]),
    );
    expect(h.log).not.toContain(`delete ${OLD_PREV}`);
    expect(h.locked.contentVersion).toBe(OLD_CV);
  });

  it('refuses an asset without a previous version with 409 ASSET_NO_PREVIOUS_VERSION and copies nothing', async () => {
    const h = harness({
      rowOverrides: {
        previousStorageLocator: null,
        previousFilename: null,
        previousMimeType: null,
        previousMimeTypeOverridden: null,
        previousKind: null,
        previousSizeBytes: null,
        previousContentVersion: null,
        previousReplacedAt: null,
      } as Partial<Asset>,
    });
    await expect(restore(h)).rejects.toMatchObject({ statusCode: 409, code: 'ASSET_NO_PREVIOUS_VERSION' });
    expect(h.log.some((l) => l.startsWith('copy') || l.startsWith('record'))).toBe(false);
  });

  it('copies the current bytes back when the transaction fails after the stable copy', async () => {
    const h = harness({ rowOverrides: PREVIOUS_FILE, failCommit: true });
    await expect(restore(h)).rejects.toThrow('commit failed');
    expect(h.copies[2]).toEqual({
      from: PREV_FROM_RESTORE,
      to: STABLE,
      visibility: 'private',
      mimeType: 'image/jpeg',
      cacheControl: 'no-cache',
      contentDisposition: cloudContentDisposition('image/jpeg', 'old.jpg'),
    });
    expect(h.log).toContain(`delete ${PREV_FROM_RESTORE}`);
    expect(h.log).not.toContain(`delete ${OLD_PREV}`);
  });
});

// Block review G — a previous version past its restorableUntil is no longer
// restorable, even before the sweep has purged it (FR-022).
describe('restorePreviousVersion — past restorableUntil', () => {
  it('refuses with 409 ASSET_NO_PREVIOUS_VERSION once the retention has passed, copying nothing', async () => {
    const h = harness({ rowOverrides: PREVIOUS_FILE });
    h.deps.loadRetentionDays = async () => 1;
    await expect(restore(h)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ASSET_NO_PREVIOUS_VERSION',
      // Issue #86 — the token picks the bundle's retention sentence.
      details: {
        code: 'retention_expired',
        restorableUntil: new Date(Date.parse('2026-10-01T00:00:00Z') + 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    expect(h.log.some((l) => l.startsWith('copy'))).toBe(false);
  });

  it('restores while the retention has not passed', async () => {
    const h = harness({ rowOverrides: PREVIOUS_FILE });
    h.deps.loadRetentionDays = async () => 3650;
    await expect(restore(h)).resolves.toBe(h.locked);
  });
});
