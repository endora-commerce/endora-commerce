import type {
  AdminFormDeclaration,
  DeploymentDivergenceDeclaration,
  FieldSetDeclaration,
  ModuleManifest,
} from '@endora-commerce/contracts';
import { hookableActionsFrom, moduleDependencyClosureFrom } from '../lifecycle/command-hook-inputs.js';
import type { FormDeclarationsInput } from './seal.js';

/**
 * What `composeModules` seals the form registry against
 * (`specs/193-admin-form-extensions/` WP-B), derived by a root from the
 * manifests it resolved — beside `hookableActionsFrom`, for its reason: the
 * composer is handed data and never reads a manifest. The grants are the
 * deployment's, from its `divergence.ts`, and travel with the rest.
 */
export function formDeclarationsFrom(
  manifests: readonly ModuleManifest[],
  formOverrideGrants?: DeploymentDivergenceDeclaration['formOverrideGrants'],
): FormDeclarationsInput {
  // The manifest holds the Zod twins' output; under `exactOptionalPropertyTypes`
  // an absent optional reads as `| undefined`, which the declaration interfaces
  // spell as absent. Same data, so the cast is only the spelling.
  return {
    fieldSets: manifests.flatMap((manifest) => (manifest.fieldSets ?? []).map((set) => ({ moduleId: manifest.id, set: set as FieldSetDeclaration }))),
    adminForms: manifests.flatMap((manifest) => (manifest.adminForms ?? []).map((form) => ({ moduleId: manifest.id, form: form as AdminFormDeclaration }))),
    formOverrides: manifests.flatMap((manifest) => (manifest.formOverrides ?? []).map((override) => ({ moduleId: manifest.id, override }))),
    inputControls: manifests.flatMap((manifest) => (manifest.inputControls ?? []).map((control) => ({ moduleId: manifest.id, control }))),
    hookableActions: hookableActionsFrom(manifests),
    moduleDependencies: moduleDependencyClosureFrom(manifests),
    permissionCodes: [...new Set(manifests.flatMap((manifest) => (manifest.permissions ?? []).map((permission) => permission.code)))].sort(),
    formOverrideGrants: formOverrideGrants ?? {},
  };
}
