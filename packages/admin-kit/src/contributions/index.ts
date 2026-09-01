/**
 * The declaration types a module package's `./admin` layer is written against
 * (feature 091, Phase 1).
 *
 * Re-exported from `@endora-commerce/contracts` **so a module needs one import
 * for the shapes and not two** — the reason
 * `specs/091-module-owned-admin-surfaces/contracts/admin-kit-surface.md` §2
 * gives this subpath. The declarations themselves live in `contracts` because
 * Principle II puts a shape crossing a package boundary there, beside
 * `ModuleManifest` and `ModuleActionSchema`.
 *
 * **Every export here is the identical binding, never a copy.** The re-export
 * carries the symbol through; `contracts` is a peer dependency, so an
 * application resolves exactly one copy of it and
 * `AdminZoneNameSchema` compared across the seam is the same object. That is
 * not a nicety: a second `z.enum` would validate the same strings and fail an
 * `instanceof`, and the failure would be silent — which is the property
 * `check:singleton-identity` exists to protect on the backend and which has no
 * frontend instrument yet.
 *
 * The barrel is **explicit and holds no `export *`**, per
 * `admin-kit-surface.md` R2: a short published set reports more findings than a
 * complete one, and its obvious repair is to widen the barrel silently.
 */
export {
  AdminNavDeclarationSchema,
  AdminNavSectionNameSchema,
  AdminRouteDeclarationSchema,
  AdminZoneContributionSchema,
  AdminZoneNameSchema,
  PermissionRequirementSchema,
} from '@endora-commerce/contracts';

export type {
  AdminComponentFactory,
  AdminContributions,
  AdminNavDeclaration,
  AdminNavSectionName,
  AdminRouteDeclaration,
  AdminZoneContribution,
  AdminZoneName,
  AdminZoneProps,
  AdminZonePropsMap,
  DeliveryMethodIntegrationsZoneProps,
  PermissionRequirement,
  ProductEditorFieldZoneProps,
  ProductEditorZoneProps,
} from '@endora-commerce/contracts';

/**
 * The contributor's end of a zone's props contract — the kit's own, not a
 * re-export.
 *
 * It lives here rather than in `contracts` because it names `ComponentType`,
 * and that package is compiled by the backend and may acquire no React
 * dependency. That split is what leaves `AdminComponentFactory` resolving to
 * `{ default: unknown }`, and this helper is what makes the `unknown` a courier
 * between two checked ends rather than a hole.
 *
 * It stays on `./contributions` and not on `./zones` because it is the
 * **contributor's** side and carries no runtime behaviour: a module's
 * `src/admin/index.ts` must be enumerable without evaluating a React tree, and
 * R2 of `admin-contribution.md` is what that rule protects.
 */
export { zoneComponent } from './zone-component.js';
export type { AdminZoneComponent, ZoneComponentOptions } from './zone-component.js';
