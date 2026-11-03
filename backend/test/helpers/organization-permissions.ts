import type { PermissionScanRoot } from '../../../packages/modules/admin_roles/src/backend/permission-inventory.js';
import type { ReadSizeInput } from '../../scripts/lib/read-size.js';

/**
 * The organization-permission half of the permission inventory
 * (`specs/170-organization-roles/` WP-01, T012/T020). Stub — implemented in T020.
 */

export type OrganizationPermissionFindingKind =
  | 'cross-vocabulary'
  | 'foreign-declarer'
  | 'undeclared-check'
  | 'unchecked-declaration'
  | 'missing-label'
  | 'split-label'
  | 'unresolved-argument';

export interface OrganizationPermissionDeclarationRow {
  readonly moduleId: string;
  readonly code: string;
}

export interface OrganizationPermissionSite {
  readonly file: string;
  readonly callee: 'organizationPermissionPreHandler' | 'can' | 'assert' | 'rolesHolding';
  readonly expression: string;
  readonly resolution: 'code' | 'runtime-value' | 'unresolved';
  readonly codes: readonly string[];
}

export interface OrganizationPermissionInventoryInput {
  readonly declarations: readonly OrganizationPermissionDeclarationRow[];
  readonly operatorCodes: ReadonlySet<string>;
  readonly sites: readonly OrganizationPermissionSite[];
  readonly bundles: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;
  readonly languages: readonly string[];
}

export interface OrganizationPermissionFinding {
  readonly kind: OrganizationPermissionFindingKind;
  readonly code: string;
  readonly module?: string;
  readonly file?: string;
  readonly language?: string;
  readonly detail: string;
}

export interface OrganizationPermissionDeclarationWalk {
  readonly declarations: readonly OrganizationPermissionDeclarationRow[];
  readonly bundles: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;
  readonly bundleFiles: number;
  readonly manifests: number;
  readonly located: number;
}

export interface OrganizationPermissionSiteScan {
  readonly files: number;
  readonly sites: readonly OrganizationPermissionSite[];
}

export function walkOrganizationPermissionDeclarations(
  _entries: ReadonlyArray<{ manifest: unknown; filePath: string }>,
): OrganizationPermissionDeclarationWalk {
  throw new Error('not implemented (T020)');
}

export function scanOrganizationPermissionSites(
  _roots: ReadonlyArray<string | PermissionScanRoot>,
): OrganizationPermissionSiteScan {
  throw new Error('not implemented (T020)');
}

export function scanOrganizationPermissionSource(_source: string, _file: string): OrganizationPermissionSite[] {
  throw new Error('not implemented (T020)');
}

export function findOrganizationPermissionDefects(
  _input: OrganizationPermissionInventoryInput,
): OrganizationPermissionFinding[] {
  throw new Error('not implemented (T020)');
}

export function organizationPermissionReadSize(
  _walk: OrganizationPermissionDeclarationWalk,
  _scan: OrganizationPermissionSiteScan,
): ReadSizeInput {
  throw new Error('not implemented (T020)');
}
