// Megamenu → CmsReferenceRegistry external scanner — feature 015 / T047.
//
// Adapts the in-process `MegamenuReferenceRegistry` into the shape the
// CMS module's `CmsReferenceRegistry` registers. When the CMS module's
// page or block delete endpoints consult their registry, our scanner
// surfaces megamenu items that hold the reference, so the delete is
// refused with the merged-holder list.
//
// Both shapes are read from `@endora-commerce/contracts` since feature 075's Phase C, so
// this module no longer names a file in `cms`. The seam itself is unchanged:
// an ungated registration `cms` enumerates on delete, honoured while `megamenu`
// is off because the items still hold the reference.

import type { CmsExternalReferenceScanner, CmsReference } from '@endora-commerce/contracts';
import type { MegamenuReferenceRegistry } from './megamenu-reference-registry.js';

export function registerMegamenuCmsReferences(
  // `CmsReferenceRegistryPort` is the whole seam; a contributor calls one
  // method of it, and `cms`' registry spells the other one `externalOwners`.
  // Naming just `register` keeps this signature what it has always been while
  // the scanner shape comes from the contract.
  cmsRegistry: { register: (scanner: CmsExternalReferenceScanner) => void },
  megamenuRegistry: MegamenuReferenceRegistry,
): void {
  cmsRegistry.register({
    ownerModuleId: 'megamenu',
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
