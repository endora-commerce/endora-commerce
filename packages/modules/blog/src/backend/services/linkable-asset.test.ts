import { describe, expect, it } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { publicAssetUrlResolver } from './linkable-asset.js';

const A1 = '00000000-0000-4000-8000-000000000001';

function reader(urls: Record<string, string>) {
  const calls: string[][] = [];
  return {
    calls,
    async resolvePublicUrls(assetIds: readonly string[]) {
      calls.push([...assetIds]);
      return new Map(assetIds.filter((id) => urls[id]).map((id) => [id, urls[id]!]));
    },
  };
}

describe('publicAssetUrlResolver', () => {
  it('answers a public asset with its URL through the batched read, never the detail', async () => {
    const assets = reader({ [A1]: 'https://cdn.example/a1.jpg?v=2' });
    const resolve = publicAssetUrlResolver(assets);

    expect(await resolve(A1)).toBe('https://cdn.example/a1.jpg?v=2');
    expect(assets.calls).toEqual([[A1]]);
  });

  it('answers null for an asset with no stable public URL', async () => {
    expect(await publicAssetUrlResolver(reader({}))(A1)).toBeNull();
  });

  it('lets the owner being off answer, rather than absorbing it as no image', async () => {
    const off = publicAssetUrlResolver({
      resolvePublicUrls: async () => {
        throw new ModuleDisabledError('assets_library');
      },
    });
    await expect(off(A1)).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});
