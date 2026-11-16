import { describe, expect, it, vi } from 'vitest';
import { assetIdSettingValidator, contentAssetIds, unlinkableAssetIds } from './assets-library.js';

// Issue #544 (owner ruling 2026-10-30, option a): an asset id a write newly
// adds is refused unless the caller may see it, a missing id included; an id
// already stored by the record is its own reference and is not asked about.

const VISIBLE = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const HIDDEN = '1b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const MISSING = '2b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';

function port(visible: readonly string[]) {
  return {
    visibleToCaller: vi.fn(async (ids: readonly string[]) => new Set(ids.filter((id) => visible.includes(id)))),
  };
}

describe('contentAssetIds', () => {
  it('collects every non-empty string under a key ending in assetId, at any depth', () => {
    const tree = {
      content: [
        { type: 'Image', props: { assetId: VISIBLE, title: HIDDEN } },
        { type: 'Hero', props: { mobileImageAssetId: MISSING, iconAssetId: '' } },
        { type: 'Card', props: { items: [{ posterAssetID: ' padded ' }] } },
      ],
      zones: { 'a:b': [{ type: 'Video', props: { videoAssetId: HIDDEN } }] },
    };
    expect([...contentAssetIds(tree)].sort()).toEqual([' padded ', HIDDEN, MISSING, VISIBLE].sort());
  });

  it('answers nothing for a value that is not a tree', () => {
    expect(contentAssetIds(null).size).toBe(0);
    expect(contentAssetIds('x').size).toBe(0);
  });
});

describe('unlinkableAssetIds', () => {
  it('refuses a newly added id the caller may not see, and a missing one alike', async () => {
    const assets = port([VISIBLE]);
    expect(await unlinkableAssetIds(assets, [VISIBLE, HIDDEN, MISSING])).toEqual([HIDDEN, MISSING].sort());
  });

  it('does not ask about an id the record already stores, whatever its case or padding', async () => {
    const assets = port([]);
    expect(await unlinkableAssetIds(assets, [HIDDEN.toUpperCase(), ` ${MISSING}`], [HIDDEN, MISSING])).toEqual([]);
    expect(assets.visibleToCaller).not.toHaveBeenCalled();
  });

  it('asks once, about the added ids only, lower-cased and trimmed', async () => {
    const assets = port([VISIBLE]);
    expect(await unlinkableAssetIds(assets, [` ${VISIBLE.toUpperCase()} `, HIDDEN, '', '  '], [HIDDEN])).toEqual([]);
    expect(assets.visibleToCaller).toHaveBeenCalledTimes(1);
    expect(assets.visibleToCaller).toHaveBeenCalledWith([VISIBLE]);
  });

  it('refuses a value that is not an asset id at all, as a missing one', async () => {
    expect(await unlinkableAssetIds(port([]), ['not-a-uuid'])).toEqual(['not-a-uuid']);
  });
});

describe('assetIdSettingValidator', () => {
  const refuse = (assetId: string) => new Error(`refused ${assetId}`);
  const input = (proposedValue: unknown, currentValues: unknown[] = ['']) => ({
    code: 'shop.logo_asset_id',
    ownerModuleId: 'settings',
    proposedValue,
    currentValues,
    projection: [],
    targetedChannelIds: [],
  });

  it('refuses a newly set id the caller may not see, and a missing one', async () => {
    const validator = assetIdSettingValidator({ contributorModuleId: 'settings', codes: ['shop.logo_asset_id'], assets: port([VISIBLE]), refuse });
    await expect(validator.validate(input(HIDDEN))).rejects.toThrow(`refused ${HIDDEN}`);
    await expect(validator.validate(input(MISSING))).rejects.toThrow(`refused ${MISSING}`);
    await expect(validator.validate(input(VISIBLE))).resolves.toBeUndefined();
  });

  it('accepts clearing the value, and re-saving a value already stored', async () => {
    const assets = port([]);
    const validator = assetIdSettingValidator({ contributorModuleId: 'settings', codes: ['shop.logo_asset_id'], assets, refuse });
    await expect(validator.validate(input(''))).resolves.toBeUndefined();
    await expect(validator.validate(input('  '))).resolves.toBeUndefined();
    await expect(validator.validate(input(HIDDEN, ['', HIDDEN]))).resolves.toBeUndefined();
    expect(assets.visibleToCaller).not.toHaveBeenCalled();
  });
});
