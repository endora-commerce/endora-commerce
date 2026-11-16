import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { CMS_SETTING_CODES } from '../../manifest.js';
import { createDefaultShareImageValidator } from './default-share-image-validator.js';

// Issue #544 — the default sharing image is published in every page's social
// meta, so an id the administrator may not see in the library is refused
// exactly as a missing one (owner ruling 2026-10-30, option a).

const VISIBLE = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const HIDDEN = '1b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const assets = { visibleToCaller: async (ids: readonly string[]) => new Set(ids.filter((id) => id === VISIBLE)) };
const input = (proposedValue: unknown, currentValues: unknown[] = ['']) => ({
  code: CMS_SETTING_CODES.DEFAULT_SHARE_IMAGE_ASSET_ID,
  ownerModuleId: 'cms',
  proposedValue,
  currentValues,
  projection: [],
  targetedChannelIds: [],
});

describe('cms default sharing image write validator', () => {
  const validator = createDefaultShareImageValidator(assets);

  it('answers for cms.default_share_image_asset_id, contributed by cms', () => {
    expect(validator.codes).toEqual([CMS_SETTING_CODES.DEFAULT_SHARE_IMAGE_ASSET_ID]);
    expect(validator.contributorModuleId).toBe('cms');
  });

  it('refuses a hidden image as a missing one', async () => {
    const err = await validator.validate(input(HIDDEN)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe(ERROR_CODES.ASSET_NOT_FOUND);
  });

  it('accepts a visible image, an unset one, and the image already stored', async () => {
    await expect(validator.validate(input(VISIBLE))).resolves.toBeUndefined();
    await expect(validator.validate(input(''))).resolves.toBeUndefined();
    await expect(validator.validate(input(HIDDEN, [HIDDEN]))).resolves.toBeUndefined();
  });
});
