import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type MegamenuItem } from '@endora-commerce/contracts';
import { HttpError } from '../../../src/http/error-envelope.js';
import {
  validateTarget,
  type TargetValidatorDeps,
} from '../../../../packages/modules/megamenu/src/backend/services/target-validator.js';

const stubDeps = (overrides: Partial<TargetValidatorDeps> = {}): TargetValidatorDeps => ({
  categoryExists: async () => true,
  cmsPageExists: async () => true,
  cmsBlockExists: async () => true,
  assetIs: async () => true,
  ...overrides,
});

const baseItem = {
  position: 0,
  parentId: null,
  labels: { 'en-US': 'Item' },
};

describe('target-validator (T011)', () => {
  it('accepts a category-link with a valid target', async () => {
    const item = {
      ...baseItem,
      kind: 'category-link' as const,
      target: { categoryId: '11111111-1111-1111-1111-111111111111' },
    } as MegamenuItem;
    await expect(validateTarget(item, ['ch-1'], stubDeps())).resolves.toBeUndefined();
  });

  it('rejects a category-link whose category does not exist in scope', async () => {
    const item = {
      ...baseItem,
      kind: 'category-link' as const,
      target: { categoryId: '11111111-1111-1111-1111-111111111111' },
    } as MegamenuItem;
    await expect(
      validateTarget(item, ['ch-1'], stubDeps({ categoryExists: async () => false })),
    ).rejects.toMatchObject({ code: ERROR_CODES.MEGAMENU_TARGET_OUT_OF_SCOPE });
  });

  it('rejects an external-link with a javascript: scheme via Zod, not the validator', async () => {
    // Validator only handles cross-module checks. Zod parsing in the
    // routes layer would already have blocked the bad URL before we get
    // here, but for defence in depth we also re-check in the validator.
    const item = {
      ...baseItem,
      kind: 'external-link' as const,
      target: { url: 'javascript:alert(1)' },
    } as MegamenuItem;
    await expect(validateTarget(item, [], stubDeps())).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });

  it('rejects an asset-kind asset target whose asset has the wrong kind', async () => {
    const item = {
      ...baseItem,
      kind: 'asset' as const,
      target: { assetId: '22222222-2222-2222-2222-222222222222', kind: 'image' as const },
    } as MegamenuItem;
    await expect(
      validateTarget(item, ['ch-1'], stubDeps({ assetIs: async () => false })),
    ).rejects.toMatchObject({ code: ERROR_CODES.MEGAMENU_ASSET_KIND_MISMATCH });
  });

  it('rejects a link with iconAssetId that points at a non-image asset', async () => {
    const item = {
      ...baseItem,
      kind: 'category-link' as const,
      target: {
        categoryId: '11111111-1111-1111-1111-111111111111',
        iconAssetId: '33333333-3333-3333-3333-333333333333',
        iconPosition: 'left' as const,
      },
    } as MegamenuItem;
    let invocation = 0;
    await expect(
      validateTarget(
        item,
        ['ch-1'],
        stubDeps({
          assetIs: async (_id, expected) => {
            invocation += 1;
            // Icon must be image; we simulate a video.
            return expected === 'image' ? false : true;
          },
        }),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.MEGAMENU_ASSET_KIND_MISMATCH });
    expect(invocation).toBe(1);
  });

  it('accepts a button with a closed-set variant', async () => {
    const item = {
      ...baseItem,
      kind: 'button' as const,
      target: { url: '/promotions', variant: 'primary' as const },
    } as MegamenuItem;
    await expect(validateTarget(item, [], stubDeps())).resolves.toBeUndefined();
  });

  it('rejects a cms-block-embed whose block is out of scope', async () => {
    const item = {
      ...baseItem,
      kind: 'cms-block-embed' as const,
      target: { blockId: '44444444-4444-4444-4444-444444444444', embedSide: 'right' as const },
    } as MegamenuItem;
    await expect(
      validateTarget(item, ['ch-1'], stubDeps({ cmsBlockExists: async () => false })),
    ).rejects.toMatchObject({ code: ERROR_CODES.MEGAMENU_TARGET_OUT_OF_SCOPE });
  });

  it('refuses a free-URL asset target until Assets Library importFromUrl lands', async () => {
    const item = {
      ...baseItem,
      kind: 'asset' as const,
      target: { url: 'https://cdn.example.com/hero.jpg', kind: 'image' as const },
    } as unknown as MegamenuItem;
    await expect(validateTarget(item, [], stubDeps())).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });

  it('throws HttpError so service layer can re-raise as 4xx', async () => {
    const item = {
      ...baseItem,
      kind: 'category-link' as const,
      target: { categoryId: '11111111-1111-1111-1111-111111111111' },
    } as MegamenuItem;
    await expect(
      validateTarget(item, ['ch-1'], stubDeps({ categoryExists: async () => false })),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
