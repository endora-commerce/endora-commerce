import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  type AssetDetail,
  type AssetRecord,
  type AssetStoredKind,
  type CatalogCategoryRecord,
  type CmsPageRecord,
  type MegamenuItem,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { validateTarget } from '../../../../packages/modules/megamenu/src/backend/services/target-validator.js';
import type { MegamenuCrossModulePorts } from '../../../../packages/modules/megamenu/src/backend/services/cross-module-ports.js';

/**
 * The four checks arrive as their owners' **published read ports** since
 * `specs/110-instance-repository/` T118c, where they were four closures a
 * composition root built and this module exported an interface for. The stubs
 * below are `catalog`'s, `cms`' and `assets_library`' contracts rather than a
 * shape only this file and two roots ever knew.
 *
 * `found` / `missing` say what the record is *for* — a target that resolves and
 * one that does not — because that is the only thing the validator reads. Only
 * the asset stub carries a field, `kind`, and only because the validator
 * compares it.
 */
const assetOf = (kind: AssetStoredKind): AssetRecord => ({ kind }) as AssetRecord;
/** A record whose only property the validator reads is that it is not `null`. */
const present = <T>(): T => ({}) as T;

const stubPorts = (overrides: Partial<MegamenuCrossModulePorts> = {}): MegamenuCrossModulePorts => ({
  categories: { findById: async () => present<CatalogCategoryRecord>() },
  pages: { findById: async () => present<CmsPageRecord>() },
  blocks: {
    findById: async () => ({ id: 'b', code: 'hero', active: true }),
    findLocalizedById: async () => null,
  },
  assets: { findById: async () => assetOf('image') },
  assetLibrary: { getAsset: async () => present<AssetDetail>() },
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
    await expect(validateTarget(item, ['ch-1'], stubPorts())).resolves.toBeUndefined();
  });

  it('rejects a category-link whose category does not exist in scope', async () => {
    const item = {
      ...baseItem,
      kind: 'category-link' as const,
      target: { categoryId: '11111111-1111-1111-1111-111111111111' },
    } as MegamenuItem;
    await expect(
      validateTarget(item, ['ch-1'], stubPorts({ categories: { findById: async () => null } })),
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
    await expect(validateTarget(item, [], stubPorts())).rejects.toMatchObject({
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
      validateTarget(
        item,
        ['ch-1'],
        // The target declares `image` and the library holds a video: the
        // comparison is against the record's stored kind, which is what the
        // root's `where id = ? and kind = ?` asked in SQL.
        stubPorts({ assets: { findById: async () => assetOf('video') } }),
      ),
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
        stubPorts({
          assets: {
            findById: async () => {
              invocation += 1;
              // Icon must be an image; the library holds a video.
              return assetOf('video');
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.MEGAMENU_ASSET_KIND_MISMATCH });
    // The icon is checked before the item's own target, and the refusal is the
    // first one: one read, not two.
    expect(invocation).toBe(1);
  });

  it('accepts a button with a closed-set variant', async () => {
    const item = {
      ...baseItem,
      kind: 'button' as const,
      target: { url: '/promotions', variant: 'primary' as const },
    } as MegamenuItem;
    await expect(validateTarget(item, [], stubPorts())).resolves.toBeUndefined();
  });

  it('rejects a cms-block-embed whose block is out of scope', async () => {
    const item = {
      ...baseItem,
      kind: 'cms-block-embed' as const,
      target: { blockId: '44444444-4444-4444-4444-444444444444', embedSide: 'right' as const },
    } as MegamenuItem;
    await expect(
      validateTarget(
        item,
        ['ch-1'],
        stubPorts({ blocks: { findById: async () => null, findLocalizedById: async () => null } }),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.MEGAMENU_TARGET_OUT_OF_SCOPE });
  });

  it('refuses a free-URL asset target until Assets Library importFromUrl lands', async () => {
    const item = {
      ...baseItem,
      kind: 'asset' as const,
      target: { url: 'https://cdn.example.com/hero.jpg', kind: 'image' as const },
    } as unknown as MegamenuItem;
    await expect(validateTarget(item, [], stubPorts())).rejects.toMatchObject({
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
      validateTarget(item, ['ch-1'], stubPorts({ categories: { findById: async () => null } })),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
