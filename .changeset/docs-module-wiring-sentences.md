---
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-organizations': patch
---

Documentation: two pages said their wiring was done in `composition.ts`. The megamenu module
registers its CMS and asset reference scanners in its own boot hook, and the promotions gate on
organization status is a required `PromotionService` argument that the `promotions` module wires
to `organizationReadPort.loadEffectiveOrganization`, not a raw SQL lookup.
