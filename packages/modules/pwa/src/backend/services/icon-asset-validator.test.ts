import { describe, expect, it } from 'vitest';
import { ERROR_CODES, PWA_SETTING_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { createIconAssetValidator } from './icon-asset-validator.js';

// Issue #544 — the app icon is rendered into the public manifest, so an icon
// id the administrator may not see in the asset library is refused exactly as
// a missing one (owner ruling 2026-10-30, option a).

const VISIBLE = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const HIDDEN = '1b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const assets = { visibleToCaller: async (ids: readonly string[]) => new Set(ids.filter((id) => id === VISIBLE)) };
const input = (proposedValue: unknown, currentValues: unknown[] = ['']) => ({
  code: PWA_SETTING_CODES.ICON_ASSET_ID,
  ownerModuleId: 'pwa',
  proposedValue,
  currentValues,
  projection: [],
  targetedChannelIds: [],
});

describe('pwa icon write validator', () => {
  const validator = createIconAssetValidator(assets);

  it('answers for pwa.icon_asset_id, contributed by pwa', () => {
    expect(validator.codes).toEqual([PWA_SETTING_CODES.ICON_ASSET_ID]);
    expect(validator.contributorModuleId).toBe('pwa');
  });

  it('refuses a hidden icon as a missing one', async () => {
    const err = await validator.validate(input(HIDDEN)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe(ERROR_CODES.ASSET_NOT_FOUND);
  });

  it('accepts a visible icon, an unset one, and the icon already stored', async () => {
    await expect(validator.validate(input(VISIBLE))).resolves.toBeUndefined();
    await expect(validator.validate(input(''))).resolves.toBeUndefined();
    await expect(validator.validate(input(HIDDEN, ['', HIDDEN]))).resolves.toBeUndefined();
  });
});
