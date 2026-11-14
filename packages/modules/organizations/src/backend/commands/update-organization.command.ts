import { isDeepStrictEqual } from 'node:util';
import { OptimisticLockError } from '@mikro-orm/core';
import {
  ERROR_CODES,
  isUuidShape,
  type DictionaryWriteMode,
  type OrganizationWriteUpdatePatch,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { Organization } from '../entities/organization.entity.js';
import { changedKeys } from '../services/organization-audit-state.js';

/** The fields `organization.update` may change, compared to name what changed — never recorded themselves. */
interface OrganizationIdentityState {
  name: string;
  legalName: string | null;
  vatStatus: Organization['vatStatus'];
  registeredAddress: Organization['registeredAddress'];
  orderConfirmationEmails: string[];
  [key: string]: unknown;
}

function identityOf(org: Organization): OrganizationIdentityState {
  return {
    name: org.name,
    legalName: org.legalName ?? null,
    vatStatus: org.vatStatus,
    registeredAddress: { ...org.registeredAddress },
    orderConfirmationEmails: [...(org.orderConfirmationEmails ?? [])],
  };
}

export interface UpdateOrganizationCommandDeps {
  /**
   * The country check the admin create makes, as a refusal: throws the 409
   * the caller is answered with. `mode` is `unchanged` when the address keeps
   * its country, so an Organization whose country was later deactivated can
   * still have its street corrected.
   */
  validateCountry(code: string, mode: DictionaryWriteMode): Promise<void>;
}

/** The port's patch, as a parsed (`undefined`-valued) object may also spell an absent key. */
export type UpdateOrganizationPatch = {
  readonly [K in keyof OrganizationWriteUpdatePatch]?: OrganizationWriteUpdatePatch[K] | undefined;
};

export interface UpdateOrganizationInput {
  readonly organizationId: string;
  readonly patch: UpdateOrganizationPatch;
  readonly expectedVersion?: number;
}

function versionConflict(currentVersion: number | null): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.VERSION_CONFLICT,
    'Organization was modified by another request. Refresh and retry.',
    { code: 'organization_version_mismatch', currentVersion },
  );
}

/**
 * `organization.update` — an Organization's identity and contact fields (name,
 * legal name, VAT status, registered address, order-confirmation e-mails), the
 * Command behind `organizationWritePort.update` (issue #1029, Principle XIII).
 *
 * Only a live Organization is writable: an id that is not a uuid, an unknown id
 * and a soft-deleted row are all `404 NOT_FOUND`. An `expectedVersion` the row
 * has moved past is `409 VERSION_CONFLICT`, and so is a concurrent write that
 * wins between this Command's read and its flush (the entity's `version`
 * column is MikroORM's optimistic lock).
 *
 * A patch that changes nothing flushes nothing and answers `skipAudit`, so a
 * connector re-applying an unchanged record leaves no entry and does not move
 * the version. The audit entry carries names, not values (issue #470,
 * `specs/conventions/audit-state.md`): the VAT status code on both sides and,
 * after, the sorted names of the fields that changed. The tax ID is not
 * writable here — a correction is `organization.tax_id.change`.
 *
 * Callers validate the patch's shape before running it; this Command trusts it.
 */
export function makeUpdateOrganizationCommand(
  deps: UpdateOrganizationCommandDeps,
  input: UpdateOrganizationInput,
): Command<Organization> {
  return {
    action: 'organization.update',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      if (!isUuidShape(input.organizationId)) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      }
      const org = await em.findOne(Organization, { id: input.organizationId, deletedAt: null });
      if (!org) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      }
      if (input.expectedVersion !== undefined && org.version !== input.expectedVersion) {
        throw versionConflict(org.version);
      }

      const { patch } = input;
      if (patch.registeredAddress !== undefined) {
        const country = patch.registeredAddress.country;
        await deps.validateCountry(
          country,
          country === org.registeredAddress.country ? 'unchanged' : 'create-or-change',
        );
      }

      const before = identityOf(org);
      const after: OrganizationIdentityState = {
        name: patch.name ?? before.name,
        legalName: patch.legalName !== undefined ? patch.legalName : before.legalName,
        vatStatus: patch.vatStatus ?? before.vatStatus,
        registeredAddress:
          patch.registeredAddress !== undefined
            ? {
                street: patch.registeredAddress.street,
                city: patch.registeredAddress.city,
                postalCode: patch.registeredAddress.postalCode,
                country: patch.registeredAddress.country,
              }
            : before.registeredAddress,
        orderConfirmationEmails:
          patch.orderConfirmationEmails !== undefined
            ? [...patch.orderConfirmationEmails]
            : before.orderConfirmationEmails,
      };
      if (isDeepStrictEqual(before, after)) {
        return { result: org, skipAudit: true };
      }

      // Each field is assigned only when it changed, so MikroORM's change set —
      // and the optimistic-lock bump — covers exactly what the entry records.
      if (after.name !== before.name) org.name = after.name;
      if (after.legalName !== before.legalName) org.legalName = after.legalName;
      if (after.vatStatus !== before.vatStatus) org.vatStatus = after.vatStatus;
      if (!isDeepStrictEqual(after.registeredAddress, before.registeredAddress)) {
        org.registeredAddress = after.registeredAddress;
      }
      if (!isDeepStrictEqual(after.orderConfirmationEmails, before.orderConfirmationEmails)) {
        org.orderConfirmationEmails = after.orderConfirmationEmails;
      }
      try {
        await em.flush();
      } catch (err) {
        if (err instanceof OptimisticLockError) throw versionConflict(null);
        throw err;
      }
      return {
        result: org,
        before: { vatStatus: before.vatStatus },
        after: { vatStatus: org.vatStatus, changedFields: changedKeys(before, after) },
      };
    },
  };
}
