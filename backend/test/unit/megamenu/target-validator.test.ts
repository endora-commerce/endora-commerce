import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
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
const assetOf = (kind: AssetStoredKind, id = '22222222-2222-4222-8222-222222222222'): AssetRecord =>
  ({ id, kind }) as AssetRecord;
/** A record whose only property the validator reads is that it is not `null`. */
const present = <T>(): T => ({}) as T;
/** The URL read the validator never makes: only the storefront resolver asks it. */
const noUrls = async () => new Map<string, string>();

const stubPorts = (overrides: Partial<MegamenuCrossModulePorts> = {}): MegamenuCrossModulePorts => ({
  categories: { findById: async () => present<CatalogCategoryRecord>(), listAll: async () => [] },
  pages: { findById: async () => present<CmsPageRecord>(), findStorefrontLinks: async () => [] },
  blocks: {
    findById: async () => ({ id: 'b', code: 'hero', active: true }),
    findLocalizedById: async () => null,
  },
  assets: {
    findById: async () => assetOf('image'),
    visibleToCaller: async (ids: readonly string[]) => new Set(ids),
    resolveUrls: noUrls,
  },
  customerGroups: { findByIds: async () => [] },
  customerAccounts: { findById: async () => null },
  organizations: { findById: async () => null },
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
      validateTarget(item, ['ch-1'], stubPorts({ categories: { findById: async () => null, listAll: async () => [] } })),
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
        stubPorts({
          assets: { findById: async () => assetOf('video'), visibleToCaller: async (ids) => new Set(ids), resolveUrls: noUrls },
        }),
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
            visibleToCaller: async (ids) => new Set(ids),
            resolveUrls: noUrls,
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
      id: 'item-free-url',
      kind: 'asset' as const,
      target: { url: 'https://cdn.example.com/hero.jpg', kind: 'image' as const },
    } as unknown as MegamenuItem;
    // Issue #640 — a missing capability, not a malformed item: a code of its own.
    await expect(validateTarget(item, [], stubPorts())).rejects.toMatchObject({
      statusCode: 400,
      code: ERROR_CODES.MEGAMENU_ASSET_URL_UNSUPPORTED,
      details: { itemId: 'item-free-url' },
    });
  });

  it('throws HttpError so service layer can re-raise as 4xx', async () => {
    const item = {
      ...baseItem,
      kind: 'category-link' as const,
      target: { categoryId: '11111111-1111-1111-1111-111111111111' },
    } as MegamenuItem;
    await expect(
      validateTarget(item, ['ch-1'], stubPorts({ categories: { findById: async () => null, listAll: async () => [] } })),
    ).rejects.toBeInstanceOf(HttpError);
  });

  /**
   * `specs/166-asset-reference-visibility/` FR-006, review T055 F-2: an asset
   * the library hides from the caller is not there to link. A menu item is an
   * unrestricted reference, so accepting one would make the file visible to
   * every library reader; and a refusal that differed from a missing asset's
   * would say the id exists.
   */
  describe('an asset the caller may not see answers as a missing one (FR-006)', () => {
    const HIDDEN = '44444444-4444-4444-8444-444444444444';
    const hiddenPorts = (asked: string[][]) =>
      stubPorts({
        assets: {
          findById: async (id: string) => assetOf('image', id),
          visibleToCaller: async (ids) => {
            asked.push([...ids]);
            return new Set();
          },
          resolveUrls: noUrls,
        },
      });
    const missingPorts = stubPorts({
      assets: { findById: async () => null, visibleToCaller: async () => new Set(), resolveUrls: noUrls },
    });
    const refusal = async (item: MegamenuItem, ports: MegamenuCrossModulePorts) => {
      const err = (await validateTarget(item, ['ch-1'], ports).then(
        () => null,
        (e: unknown) => e,
      )) as HttpError | null;
      expect(err).toBeInstanceOf(HttpError);
      return [err!.statusCode, err!.code, err!.message];
    };

    it('an asset target', async () => {
      const item = {
        ...baseItem,
        kind: 'asset' as const,
        target: { assetId: HIDDEN, kind: 'image' as const },
      } as MegamenuItem;
      const asked: string[][] = [];
      expect(await refusal(item, hiddenPorts(asked))).toEqual(await refusal(item, missingPorts));
      expect(asked).toEqual([[HIDDEN]]);
    });

    it('an icon', async () => {
      const item = {
        ...baseItem,
        kind: 'external-link' as const,
        target: { url: 'https://example.com', iconAssetId: HIDDEN, iconPosition: 'left' as const },
      } as MegamenuItem;
      const asked: string[][] = [];
      expect(await refusal(item, hiddenPorts(asked))).toEqual(await refusal(item, missingPorts));
      expect(asked).toEqual([[HIDDEN]]);
    });

    it('a visible asset is still accepted', async () => {
      const item = {
        ...baseItem,
        kind: 'asset' as const,
        target: { assetId: HIDDEN, kind: 'image' as const },
      } as MegamenuItem;
      await expect(validateTarget(item, ['ch-1'], stubPorts())).resolves.toBeUndefined();
    });
  });
});

/** Feature 168 — a category tree names a root that must exist, or none at all. */
describe('validateTarget — category-tree (feature 168)', () => {
  const tree = (rootCategoryId: string | null): MegamenuItem =>
    ({ ...baseItem, kind: 'category-tree', labels: {}, target: { rootCategoryId, depth: 2 } }) as MegamenuItem;

  it('accepts a whole-catalogue tree without reading the catalogue', async () => {
    let reads = 0;
    const ports = stubPorts({
      categories: {
        findById: async () => {
          reads += 1;
          return null;
        },
        listAll: async () => [],
      },
    });
    await validateTarget(tree(null), ['ch-1'], ports);
    expect(reads).toBe(0);
  });

  it('refuses a tree rooted at a category that does not exist', async () => {
    await expect(
      validateTarget(
        tree('11111111-1111-1111-1111-111111111111'),
        ['ch-1'],
        stubPorts({ categories: { findById: async () => null, listAll: async () => [] } }),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.MEGAMENU_TARGET_OUT_OF_SCOPE });
  });
});
