import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { AuditState } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { unknownCodes, type OrganizationRoleCatalogue } from './organization-role-catalogue.js';
import type { OrganizationRoleRow, OrganizationRoleStore } from './organization-role-store.js';

/**
 * The rules the three `organization_role.*` Commands share
 * (`specs/170-organization-roles/` data-model §1; research R-29, R-32).
 */

/** FR-004 — custom roles per Organization; the predefined two are not counted. */
export const MAX_CUSTOM_ROLES_PER_ORGANIZATION = 50;

/** What every role Command is built with. */
export interface OrganizationRoleCommandDeps {
  readonly catalogue: OrganizationRoleCatalogue;
  readonly store: (em: EntityManager) => OrganizationRoleStore;
  /**
   * The predefined roles' labels in every shipped language (`Administrator`,
   * `Member` and their Polish labels): a custom role may not take one (R-29).
   */
  readonly reservedNames: readonly string[];
}

/** The comparison form of a role name: trimmed, lower-cased (FR-004). */
export function normalizeRoleName(name: string): string {
  return name.trim().toLowerCase();
}

export function roleNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization role not found.');
}

/**
 * The Organization a role Command acts on, locked: absent, invisible or
 * personal all answer 404 — role management is not offered for a personal
 * Organization (spec *Edge Cases*; owner ruling PR-3).
 */
export async function lockCompanyOrganization(store: OrganizationRoleStore, organizationId: string): Promise<void> {
  const organization = await store.lockOrganization(organizationId);
  if (organization === null || organization.isPersonal) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
  }
}

export function refuseUnknownCodes(submitted: readonly string[], catalogue: OrganizationRoleCatalogue): void {
  const unknown = unknownCodes(submitted, catalogue);
  if (unknown.length > 0) {
    throw new HttpError(
      422,
      ERROR_CODES.ORGANIZATION_PERMISSION_UNKNOWN,
      `Unknown organization permission(s): ${unknown.join(', ')}.`,
      { permissions: unknown },
    );
  }
}

/**
 * Refuses a custom-role name another custom role of the Organization already
 * uses, or that equals a predefined role's label in a shipped language — both
 * after trimming and case folding (FR-004, R-29). `exceptRoleId` is the role
 * being renamed. The partial unique index is the database's second line.
 */
export async function refuseTakenName(
  store: OrganizationRoleStore,
  deps: Pick<OrganizationRoleCommandDeps, 'reservedNames'>,
  organizationId: string,
  name: string,
  exceptRoleId: string | null,
): Promise<string> {
  const normalized = normalizeRoleName(name);
  const reserved = deps.reservedNames.some((label) => normalizeRoleName(label) === normalized);
  const taken =
    reserved ||
    (await store.listInOrganization(organizationId)).some(
      (role) => role.kind === 'custom' && role.id !== exceptRoleId && role.nameNormalized === normalized,
    );
  if (taken) {
    throw new HttpError(
      409,
      ERROR_CODES.ORGANIZATION_ROLE_NAME_TAKEN,
      'Another role of this organization already has this name.',
    );
  }
  return normalized;
}

export function refuseStale(role: OrganizationRoleRow, expectedVersion: number): void {
  if (role.version !== expectedVersion) {
    throw new HttpError(
      409,
      ERROR_CODES.ORGANIZATION_ROLE_STALE,
      'This role was changed by somebody else. Reload it and try again.',
    );
  }
}

export function protectedRole(message: string): HttpError {
  return new HttpError(409, ERROR_CODES.ORGANIZATION_ROLE_PROTECTED, message);
}

/** The audit snapshot of a role, permission list sorted (R-32). */
export function auditRole(
  role: Pick<OrganizationRoleRow, 'id' | 'kind' | 'name' | 'description'>,
  permissions: readonly string[],
): AuditState {
  return {
    id: role.id,
    kind: role.kind,
    name: role.name ?? null,
    description: role.description ?? null,
    permissions: [...permissions],
  };
}

/** A domain-event envelope (`EventBase`). */
export function eventEnvelope(): { eventId: string; occurredAt: string } {
  return { eventId: randomUUID(), occurredAt: new Date().toISOString() };
}
