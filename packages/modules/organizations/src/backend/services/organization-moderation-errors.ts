import type { OrganizationStatus } from '../entities/organization.entity.js';

/**
 * The refusals of a moderation transition (feature 026; `specs/186-aggregate-ports/`
 * T026). Raised by the four moderation Commands and mapped to HTTP by the admin
 * routes: `404` not found, `409 VERSION_CONFLICT` with `currentVersion`, `422
 * ORGANIZATION_STATUS_INVALID`. Their own file so the Commands and the service
 * that runs them can both name them without importing each other.
 */

export class OrganizationNotFoundError extends Error {
  constructor(public readonly organizationId: string) {
    super(`Organization ${organizationId} not found.`);
    this.name = 'OrganizationNotFoundError';
  }
}

export class OrganizationVersionMismatchError extends Error {
  constructor(
    public readonly organizationId: string,
    public readonly expectedVersion: number,
    public readonly currentVersion: number,
  ) {
    super(
      `Organization ${organizationId} version mismatch (expected ${expectedVersion}, currently ${currentVersion}).`,
    );
    this.name = 'OrganizationVersionMismatchError';
  }
}

export class OrganizationStatusGuardError extends Error {
  constructor(
    public readonly organizationId: string,
    public readonly currentStatus: OrganizationStatus,
    public readonly requiredStatus: OrganizationStatus,
  ) {
    super(
      `Organization ${organizationId} is in status '${currentStatus}', cannot perform an action that requires '${requiredStatus}'.`,
    );
    this.name = 'OrganizationStatusGuardError';
  }
}
