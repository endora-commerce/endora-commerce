import type {
  ModuleOrganizationPermissionDeclaration,
  OrganizationRoleKind,
} from '@endora-commerce/contracts';

/**
 * The organization-permission catalogue — every code the composed modules
 * declare, and the arithmetic of a role over it (`specs/170-organization-roles/`,
 * data-model §1 and §6; research R-3, R-17; FR-002, FR-007, FR-021, FR-023,
 * FR-025).
 *
 * Three sets, all computed in memory from the manifests and never stored:
 *
 *  - **vocabulary** — every code a composed module declares, present or not;
 *  - **present** — the codes whose declaring module is effectively present
 *    (both axes; the predicate is `effectiveState.isPresent`, asked on every
 *    call so a module flip needs no cache drop — US 8, SC-007);
 *  - **member defaults** — the vocabulary's `memberDefault` codes.
 *
 * The manifests are read through a thunk because the registry this module sees
 * is the composition's — core manifests plus the deployment's overlay modules —
 * which is a host input, as it is for `admin_roles`' operator catalogue.
 */

/** What this catalogue reads off a registered manifest. */
export interface OrganizationPermissionManifestEntry {
  readonly manifest: {
    readonly id: string;
    readonly name: string;
    readonly organizationPermissions?: readonly ModuleOrganizationPermissionDeclaration[];
  };
}

/** One declared code with the module that declares it. */
export interface OrganizationPermissionDeclarationEntry extends ModuleOrganizationPermissionDeclaration {
  readonly moduleId: string;
  /** The declaring manifest's English `name` — the fallback group label. */
  readonly moduleName: string;
}

export interface OrganizationRoleCatalogueDeps {
  readonly manifests: () => readonly OrganizationPermissionManifestEntry[];
  readonly isModulePresent: (moduleId: string) => boolean;
}

export class OrganizationRoleCatalogue {
  constructor(private readonly deps: OrganizationRoleCatalogueDeps) {}

  /** Every declaration, sorted by code. */
  declarations(): readonly OrganizationPermissionDeclarationEntry[] {
    const entries: OrganizationPermissionDeclarationEntry[] = [];
    for (const { manifest } of this.deps.manifests()) {
      for (const declaration of manifest.organizationPermissions ?? []) {
        entries.push({ ...declaration, moduleId: manifest.id, moduleName: manifest.name });
      }
    }
    return entries.sort((a, b) => compareCodes(a.code, b.code));
  }

  declarationOf(code: string): OrganizationPermissionDeclarationEntry | undefined {
    return this.declarations().find((entry) => entry.code === code);
  }

  vocabulary(): ReadonlySet<string> {
    return new Set(this.declarations().map((entry) => entry.code));
  }

  isKnown(code: string): boolean {
    return this.declarationOf(code) !== undefined;
  }

  /** Declared, and its declaring module is effectively present. */
  isPresent(code: string): boolean {
    const entry = this.declarationOf(code);
    return entry !== undefined && this.deps.isModulePresent(entry.moduleId);
  }

  /** The present codes, sorted. */
  presentCodes(): readonly string[] {
    return this.declarations()
      .filter((entry) => this.deps.isModulePresent(entry.moduleId))
      .map((entry) => entry.code);
  }

  /** The vocabulary's member-default codes, present or not (FR-021). */
  memberDefaults(): ReadonlySet<string> {
    return new Set(this.declarations().filter((entry) => entry.memberDefault).map((entry) => entry.code));
  }
}

/** The stored state of a role that the arithmetic below reads. */
export interface RoleGrantState {
  readonly kind: OrganizationRoleKind;
  readonly permissions: Iterable<string>;
  readonly memberDefaultsOffered: Iterable<string>;
}

/**
 * What a role grants **before** presence is applied, sorted.
 *
 *  - `administrator` — the whole vocabulary (it stores nothing; R-3).
 *  - `member` — its stored grants plus every member default it has not been
 *    offered yet (R-17).
 *  - `custom` — its stored grants.
 *
 * A stored code no module declares any more is kept here (it is still stored);
 * {@link effectiveCodes} never answers it, and a save drops it.
 */
export function grantedCodes(role: RoleGrantState, catalogue: OrganizationRoleCatalogue): string[] {
  if (role.kind === 'administrator') return [...catalogue.vocabulary()].sort(compareCodes);
  const granted = new Set(role.permissions);
  if (role.kind === 'member') {
    const offered = new Set(role.memberDefaultsOffered);
    for (const code of catalogue.memberDefaults()) if (!offered.has(code)) granted.add(code);
  }
  return [...granted].sort(compareCodes);
}

/** What a role holds now: {@link grantedCodes} ∩ present, sorted (FR-007). */
export function effectiveCodes(role: RoleGrantState, catalogue: OrganizationRoleCatalogue): string[] {
  const present = new Set(catalogue.presentCodes());
  return grantedCodes(role, catalogue).filter((code) => present.has(code));
}

/** The submitted codes no module declares, in submission order, once each. */
export function unknownCodes(submitted: readonly string[], catalogue: OrganizationRoleCatalogue): string[] {
  const vocabulary = catalogue.vocabulary();
  return [...new Set(submitted.filter((code) => !vocabulary.has(code)))];
}

/**
 * The stored state a save produces (data-model §1, FR-025):
 *
 *     permissions = (submitted ∩ present) ∪ (granted-before ∩ vocabulary ∖ present)
 *
 * so the grant of a switched-off module survives an editor that could not show
 * it, and a code no module declares any more is dropped. For *Member* the save
 * also materialises the offer — `memberDefaultsOffered ∪= vocabularyMemberDefaults`
 * — which is what keeps an un-ticked default un-ticked across a switch-off/on
 * and an uninstall/reinstall (FR-023, R-17); the ledger is never pruned.
 *
 * Callers refuse {@link unknownCodes} before calling this.
 */
export function mergeSubmittedPermissions(
  role: RoleGrantState,
  submitted: readonly string[],
  catalogue: OrganizationRoleCatalogue,
): { permissions: string[]; memberDefaultsOffered: string[] } {
  const vocabulary = catalogue.vocabulary();
  const present = new Set(catalogue.presentCodes());
  const next = new Set(submitted.filter((code) => present.has(code)));
  for (const code of grantedCodes(role, catalogue)) {
    if (vocabulary.has(code) && !present.has(code)) next.add(code);
  }
  const offered = new Set(role.memberDefaultsOffered);
  if (role.kind === 'member') for (const code of catalogue.memberDefaults()) offered.add(code);
  return {
    permissions: [...next].sort(compareCodes),
    memberDefaultsOffered: [...offered].sort(compareCodes),
  };
}

/** Code-point order: stable across locales, which a sorted audit diff relies on. */
export function compareCodes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
