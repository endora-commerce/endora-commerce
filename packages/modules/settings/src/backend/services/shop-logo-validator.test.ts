import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { createShopLogoValidator } from './shop-logo-validator.js';
import { SHOP_LOGO_ASSET_ID } from './shop-info-resolver.js';

// Issue #544 — the shop logo is published on every storefront page, so a
// logo id the administrator may not see in the library is refused as a
// missing one (owner ruling 2026-10-30, option a).

const VISIBLE = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const HIDDEN = '1b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';

const assets = { visibleToCaller: async (ids: readonly string[]) => new Set(ids.filter((id) => id === VISIBLE)) };
const input = (proposedValue: unknown, currentValues: unknown[] = ['']) => ({
  code: SHOP_LOGO_ASSET_ID,
  ownerModuleId: 'settings',
  proposedValue,
  currentValues,
  projection: [],
  targetedChannelIds: [],
});

describe('shop logo write validator', () => {
  const validator = createShopLogoValidator(assets);

  it('answers for shop.logo_asset_id, contributed by settings', () => {
    expect(validator.codes).toEqual([SHOP_LOGO_ASSET_ID]);
    expect(validator.contributorModuleId).toBe('settings');
  });

  it('refuses a hidden logo exactly as a missing one', async () => {
    const hidden = await validator.validate(input(HIDDEN)).catch((err: unknown) => err);
    const missing = await validator.validate(input('2b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f')).catch((err: unknown) => err);
    for (const err of [hidden, missing]) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(404);
      expect((err as HttpError).code).toBe(ERROR_CODES.ASSET_NOT_FOUND);
    }
  });

  it('accepts a visible logo, an unset one, and the logo already stored', async () => {
    await expect(validator.validate(input(VISIBLE))).resolves.toBeUndefined();
    await expect(validator.validate(input(''))).resolves.toBeUndefined();
    await expect(validator.validate(input(HIDDEN, [HIDDEN]))).resolves.toBeUndefined();
  });
});
