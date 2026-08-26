import { describe, expect, it } from 'vitest';
import type {
  AssetReference,
  AssetReferenceDescriptor,
  AssetReferenceRegistryPort,
  CmsExternalReferenceScanner,
} from '@endora-commerce/contracts';
import { registerMegamenuAssetReferences } from '../../../../packages/modules/megamenu/src/backend/services/asset-references.js';
import { registerMegamenuCmsReferences } from '../../../../packages/modules/megamenu/src/backend/services/cms-references.js';
import type { MegamenuReferenceRegistry } from '../../../../packages/modules/megamenu/src/backend/services/megamenu-reference-registry.js';

/**
 * Feature 075, Phase C — what `megamenu` contributes to the two reference
 * registries, described by the `@endora-commerce/contracts` shapes rather than by the
 * classes `assets_library` and `cms` own.
 *
 * The seam is deliberately an ungated registration on both sides (D-39): a
 * scanner is inert until a delete asks it something, and both owners honour a
 * switched-off contributor's edges on purpose, because the menu items still
 * hold the reference and deleting the asset or page would be the destructive
 * outcome Principle XVII promises deactivation is not. Publishing the types
 * must not change that, so what this test pins is the contributor's identity
 * and the label an operator's 409 renders — the two things the registries read.
 */

const MENU_ID = '11111111-0000-4000-8000-000000000001';
const PAGE_ID = '22222222-0000-4000-8000-000000000002';
const BLOCK_ID = '33333333-0000-4000-8000-000000000003';

describe('megamenu contributes to the asset reference registry', () => {
  it('registers one descriptor owned by megamenu', () => {
    const registered: AssetReferenceDescriptor[] = [];
    const registry: AssetReferenceRegistryPort = {
      register: (descriptor) => {
        registered.push(descriptor);
      },
      owners: () => registered.map((d) => d.ownerModuleId),
      findReferences: async (): Promise<AssetReference[]> => [],
      findReferencesMany: async () => new Map(),
    };

    registerMegamenuAssetReferences(registry, () => {
      throw new Error('the descriptor must not touch the database until it is asked');
    });

    expect(registry.owners()).toEqual(['megamenu']);
  });
});

describe('megamenu contributes to the CMS reference registry', () => {
  const scanners: CmsExternalReferenceScanner[] = [];
  const registry = {
    register: (scanner: CmsExternalReferenceScanner): void => {
      scanners.push(scanner);
    },
  };

  const megamenuRegistry = {
    findCmsPageReferences: async () => [
      { menuId: MENU_ID, menuName: 'Main menu', itemId: 'item-1' },
    ],
    findCmsBlockReferences: async () => [
      { menuId: MENU_ID, menuName: 'Main menu', itemId: 'item-2' },
    ],
  } as unknown as MegamenuReferenceRegistry;

  it('names megamenu as the owner and labels the holding menu', async () => {
    registerMegamenuCmsReferences(registry, megamenuRegistry);

    expect(scanners.map((s) => s.ownerModuleId)).toEqual(['megamenu']);
    const scanner = scanners[0]!;
    await expect(scanner.findPageReferences!(PAGE_ID)).resolves.toEqual([
      { kind: 'megamenu', entityId: MENU_ID, label: 'Megamenu "Main menu"' },
    ]);
    await expect(scanner.findBlockReferences!(BLOCK_ID, 'block-code')).resolves.toEqual([
      { kind: 'megamenu', entityId: MENU_ID, label: 'Megamenu "Main menu"' },
    ]);
  });
});
