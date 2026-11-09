import { randomUUID } from 'node:crypto';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  isCustomFieldValidationFailure,
  type AdminOrganizationCreateBody,
  type CustomFieldValuePort,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { Organization } from '../entities/organization.entity.js';

/**
 * `organization.create` — an operator creates a customer Organization and
 * chooses its sales channels (feature 154, US5;
 * `specs/154-sales-channel-access/contracts/admin-api-and-ui.md` §3).
 *
 * **One transaction for the row and its channels.** An Organization with no
 * sales channel may sign in and shop nowhere, so the assignment is written on
 * the Command's own `em`: a failed assignment rolls the Organization back, and a
 * rolled-back create leaves no bridge row. The bridge rows are audited by the
 * kernel's membership writer, one entry per channel with the acting admin —
 * this Command records the Organization, with the chosen channels in its
 * after-state so the one entry an operator reads says where it may shop.
 *
 * The tax-id refusal is self-registration's: a pre-check for the clear 409, and
 * the unique index translated to the same 409 for the race the pre-check cannot
 * see.
 *
 * Callers validate the channel ids and the country before running it; this
 * Command trusts them, as the membership writer's foreign key would refuse an
 * unknown channel anyway (with a 500 rather than a field error).
 */
export interface CreateOrganizationCommandDeps {
  membership: Pick<SalesChannelMembershipPort, 'replaceChannelsForEntity'>;
  /**
   * Feature 175 (FR-015, FR-018) — `custom_fields`' value port. The
   * Organization's values are validated with the administrator's rules inside
   * this Command, so a refusal rolls the create back and the audit row carries
   * what was stored. Without it the values are not written, as before.
   */
  customFieldValues?: Pick<CustomFieldValuePort, 'validateAndMerge'>;
}

export function makeCreateOrganizationCommand(
  deps: CreateOrganizationCommandDeps,
  input: AdminOrganizationCreateBody,
): Command<Organization> {
  const organizationId = randomUUID();
  return {
    action: 'organization.create',
    objectType: 'organization',
    objectId: organizationId,
    run: async ({ em, actor }) => {
      const existing = await em.findOne(Organization, { taxId: input.taxId });
      if (existing) {
        throw new HttpError(
          409,
          ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS,
          'An organization with this taxId already exists.',
        );
      }
      const customFieldValues = await validatedValues(deps, input);
      const now = new Date();
      const organization = em.create(Organization, {
        id: organizationId,
        name: input.name,
        taxId: input.taxId,
        status: input.status,
        vatStatus: input.vatStatus ?? 'vat_payer',
        registeredAddress: {
          street: input.registeredAddress.street,
          city: input.registeredAddress.city,
          postalCode: input.registeredAddress.postalCode,
          country: input.registeredAddress.country,
        },
        // Created active by an operator is created approved by that operator:
        // the moderation fields say who let it trade, as `approve` would.
        ...(input.status === 'active'
          ? { approvedAt: now, approvedByAdminUserId: actor.actorAdminUserId }
          : {}),
        customFieldValues,
      });
      try {
        await em.flush();
      } catch (err) {
        if (err instanceof UniqueConstraintViolationException) {
          throw new HttpError(
            409,
            ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS,
            'An organization with this taxId already exists.',
          );
        }
        throw err;
      }

      const [first, ...rest] = input.salesChannelIds as [string, ...string[]];
      await deps.membership.replaceChannelsForEntity('organization', organization.id, [first, ...rest], {
        em,
        actorAdminUserId: actor.actorAdminUserId,
      });

      return {
        result: organization,
        before: null,
        after: {
          name: organization.name,
          taxId: organization.taxId,
          status: organization.status,
          vatStatus: organization.vatStatus,
          registeredAddress: organization.registeredAddress,
          salesChannelIds: [...new Set(input.salesChannelIds)].sort(),
          customFieldValues: organization.customFieldValues,
        },
      };
    },
  };
}

/**
 * The new Organization's bag: the values sent, validated as a merge onto an
 * empty record — so a `required` definition with no value is refused here, at
 * creation (FR-015). The refusal is the 422 every admin custom-field write
 * answers.
 */
async function validatedValues(
  deps: CreateOrganizationCommandDeps,
  input: AdminOrganizationCreateBody,
): Promise<Record<string, unknown>> {
  if (!deps.customFieldValues) return {};
  try {
    return await deps.customFieldValues.validateAndMerge('organization', {}, input.customFieldValues ?? {});
  } catch (err) {
    // Structural, as on the admin edit path; anything else is re-thrown.
    if (isCustomFieldValidationFailure(err)) {
      throw new HttpError(
        422,
        ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID,
        'One or more custom fields are invalid.',
        err.errors.map((e) => ({ path: e.field, issue: e.message })),
      );
    }
    throw err;
  }
}
