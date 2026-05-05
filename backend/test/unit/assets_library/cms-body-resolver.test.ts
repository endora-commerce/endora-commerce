import { describe, expect, it } from 'vitest';
import { findAssetRefIds } from '../../../src/modules/assets_library/services/cms-body-resolver.js';

describe('findAssetRefIds', () => {
  it('finds a single asset_ref node at the root', () => {
    const ids = findAssetRefIds({ type: 'asset_ref', assetId: 'A' });
    expect(Array.from(ids)).toEqual(['A']);
  });

  it('walks nested objects + arrays and collects every assetId', () => {
    const body = {
      blocks: [
        { kind: 'paragraph', text: 'hi' },
        {
          kind: 'image',
          inner: { type: 'asset_ref', assetId: 'A', rendering: 'image' },
        },
        {
          kind: 'card',
          children: [
            { type: 'asset_ref', assetId: 'B' },
            { type: 'asset_ref', assetId: 'C', rendering: 'link' },
          ],
        },
      ],
      footer: { type: 'asset_ref', assetId: 'A' },  // duplicate; set dedups
    };
    const ids = findAssetRefIds(body);
    expect(Array.from(ids).sort()).toEqual(['A', 'B', 'C']);
  });

  it('ignores non-asset_ref nodes that look similar', () => {
    const body = { type: 'image', assetId: 'X' };
    expect(findAssetRefIds(body).size).toBe(0);
  });

  it('skips raw URL strings (no asset_ref shape)', () => {
    const body = { url: 'https://example.com/x.jpg' };
    expect(findAssetRefIds(body).size).toBe(0);
  });
});
