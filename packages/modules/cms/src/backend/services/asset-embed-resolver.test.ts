import { describe, expect, it } from 'vitest';
import type { AssetReadPort, AssetRecord } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { createAssetEmbedResolver } from './asset-embed-resolver.js';

/**
 * `specs/110-instance-repository/` T118c — the mapping `cms` registers over
 * `assetReadPort`, drained out of a composition root. It read `assetsLibraryPort`'s
 * `getAsset` per embed until issue #685, whose detail walks every page, block,
 * template, post, product and menu for its "used by" list.
 *
 * **It composes nothing, deliberately.** An earlier draft built a real container
 * to reach the registration, which meant a module package's test naming
 * `@endora-commerce/platform/composition` — a host-internal subpath no module may
 * name, and one `check:platform-surface` cannot refuse here because
 * `collectPlatformSurfaceSources` drops `.test.ts` outright. That exclusion was
 * written when module packages had no tests; `specs/106-module-owned-tests/` has
 * since put 211 of them here, so the silence is a blind spot rather than a
 * permission, and this would have been the tree's first precedent for it. Making
 * the resolver a function of the port removes the need instead of working around
 * the check.
 *
 * **What this file cannot see** is that `backend/index.ts` wires the registration
 * at all — which is the half the defect lived in. That is
 * `backend/test/contract/cms/storefront-asset-embed.contract.test.ts`, over the
 * composed harness, and it is the one to keep.
 */

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';

function record(id: string, overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id,
    kind: 'image',
    filename: 'hero.png',
    mimeType: 'image/png',
    sizeBytes: '2048',
    storageUrl: '/media/hero.png',
    altText: null,
    folderId: null,
    visibility: 'public',
    label: 'Hero image',
    storageBackend: 'local',
    storageLocator: 'aa/bb/hero.png',
    pendingCleanup: false,
    purgeAfterAt: null,
    mimeTypeOverridden: false,
    createdAt: new Date('2026-09-09T10:00:00.000Z'),
    updatedAt: new Date('2026-09-09T10:00:00.000Z'),
    deletedAt: null,
    contentVersion: 'a1b2c3d4e5f6',
    permalink: null,
    ...overrides,
  };
}

/** A read port over these rows and URLs, recording what it is asked. */
function readsOver(rows: AssetRecord[], urls: Record<string, string>) {
  const calls = { resolveUrls: [] as string[][], findByIds: [] as string[][] };
  const port: Pick<AssetReadPort, 'resolveUrls' | 'findByIds'> = {
    async resolveUrls(ids) {
      calls.resolveUrls.push([...ids]);
      return new Map(ids.filter((id) => urls[id]).map((id) => [id, urls[id]!]));
    },
    async findByIds(ids) {
      calls.findByIds.push([...ids]);
      return rows.filter((row) => ids.includes(row.id));
    },
  };
  return { port, calls };
}

describe('T118c — the CMS asset embed resolver', () => {
  it('maps the library’s record and URL onto the embed shape', async () => {
    const { port } = readsOver([record(A1)], { [A1]: 'https://api.test/assets/file/a1?v=1' });

    expect(await createAssetEmbedResolver(port)([A1])).toEqual(
      new Map([
        [
          A1,
          {
            url: 'https://api.test/assets/file/a1?v=1',
            mimeType: 'image/png',
            filename: 'hero.png',
            label: 'Hero image',
            visibility: 'public',
          },
        ],
      ]),
    );
  });

  it('resolves every embed of a page in one batch, never once per asset (issue #685)', async () => {
    const { port, calls } = readsOver([record(A1), record(A2, { visibility: 'private' })], {
      [A1]: 'https://api.test/a1',
      [A2]: 'https://api.test/a2?token=x',
    });

    const resolved = await createAssetEmbedResolver(port)([A1, A2]);

    expect(resolved.get(A2)).toMatchObject({ url: 'https://api.test/a2?token=x', visibility: 'private' });
    expect(calls.resolveUrls).toEqual([[A1, A2]]);
    expect(calls.findByIds).toEqual([[A1, A2]]);
  });

  it('leaves out an asset the library no longer has, and asks nothing for an empty page', async () => {
    const { port, calls } = readsOver([], {});
    const resolve = createAssetEmbedResolver(port);

    expect((await resolve([A1])).size).toBe(0);
    // Only an id that has a URL is described: a stray string never reaches the row read.
    expect(calls.findByIds).toEqual([]);
    expect((await resolve([])).size).toBe(0);
    expect(calls.resolveUrls).toEqual([[A1]]);
  });

  it('lets the owner being off answer, rather than reading it as “no asset”', async () => {
    // Composition checklist item 7. `assets_library` is `nonDeactivatable`, so this
    // cannot happen on a running platform today — which is exactly why the assertion
    // is here: the day that manifest changes, a swallowed refusal turns fail-closed
    // into an asset silently missing from every page.
    const resolve = createAssetEmbedResolver({
      resolveUrls: async () => {
        throw new ModuleDisabledError('assets_library');
      },
      findByIds: async () => [],
    });

    await expect(resolve([A1])).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});
