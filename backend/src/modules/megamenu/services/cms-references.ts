// Megamenu → CmsReferenceRegistry external scanner — feature 015 / T047.
//
// Adapts the in-process `MegamenuReferenceRegistry` into the shape the
// CMS module's `CmsReferenceRegistry` registers. When the CMS module's
// page or block delete endpoints consult their registry, our scanner
// surfaces megamenu items that hold the reference, so the delete is
// refused with the merged-holder list.

import type { CmsReference, CmsExternalReferenceScanner } from '../../cms/services/cms-reference-registry.js';
import type { MegamenuReferenceRegistry } from './megamenu-reference-registry.js';

export function registerMegamenuCmsReferences(
  cmsRegistry: { register: (scanner: CmsExternalReferenceScanner) => void },
  megamenuRegistry: MegamenuReferenceRegistry,
): void {
  cmsRegistry.register({
    async findPageReferences(pageId: string): Promise<CmsReference[]> {
      const refs = await megamenuRegistry.findCmsPageReferences(pageId);
      return refs.map((ref) => ({
        kind: 'megamenu',
        entityId: ref.menuId,
        label: `Megamenu "${ref.menuName}"`,
      }));
    },
    async findBlockReferences(blockId: string): Promise<CmsReference[]> {
      const refs = await megamenuRegistry.findCmsBlockReferences(blockId);
      return refs.map((ref) => ({
        kind: 'megamenu',
        entityId: ref.menuId,
        label: `Megamenu "${ref.menuName}"`,
      }));
    },
  });
}
