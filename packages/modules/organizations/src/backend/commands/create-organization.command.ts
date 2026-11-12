import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  isCustomFieldValidationFailure,
  normalizeTaxId,
  type AdminOrganizationCreateBody,
  type CustomFieldValuePort,
  type OrganizationCreateHookData,
  type OrganizationCreateOutbox,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { Organization } from '../entities/organization.entity.js';
import type { OrganizationTreeService } from '../services/organization-tree-service.js';
import { taxIdConflictOf } from '../services/tax-id-conflict.js';
import { TaxIdScopeService } from '../services/tax-id-scope-service.js';
import { taxIdExistsRefusal } from '../services/organization-write.js';
import { ORGANIZATION_CREATED_FIELDS, presentFields } from '../services/organization-audit-state.js';
import { toOrganizationRecord } from '../services/organization-details-port.js';

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
 * the database's own refusal translated to the same 409 for the race the
 * pre-check cannot see — at the flush here (`global`'s unique constraint), and
 * at commit around the bus (`per-tree-root`'s deferred one, through
 * `runOrganizationWrite` at the route).
 *
 * **`parentId`** (`specs/177-tax-id-scope/` FR-018, `contracts/tax-id-scope.md`
 * §6) creates the organization as a branch in the same Command: the parent must
 * be live, the depth bound holds, and the path is the parent's plus the new id.
 * In `per-tree-root` the branch may carry a tax ID its tree already holds, and
 * only that; in `global` a tax ID is never on two rows. The scope is read inside
 * this transaction (FR-026). Whether the caller may name a parent at all is the
 * route's to decide (D-260).
 *
 * Callers validate the channel ids and the country before running it; this
 * Command trusts them, as the membership writer's foreign key would refuse an
 * unknown channel anyway (with a 500 rather than a field error).
 */
/**
 * What `organization.create` writes: the admin create's body, plus the legal
 * name only `organizationWritePort.create` sets (issue #1029). Its audit entry
 * names `legalName` among `changedFields` when one was stored.
 */
export type CreateOrganizationInput = AdminOrganizationCreateBody & {
  readonly legalName?: string | null | undefined;
};

export interface CreateOrganizationCommandDeps {
  membership: Pick<SalesChannelMembershipPort, 'replaceChannelsForEntity'>;
  /** The depth bound for a branch; required when the input names a parent. */
  tree?: Pick<OrganizationTreeService, 'assertMaxDepth'>;
  /**
   * Feature 175 (FR-015, FR-018) — `custom_fields`' value port. The
   * Organization's values are validated with the administrator's rules inside
   * this Command, so a refusal rolls the create back and the audit row names
   * what was stored. Without it the values are not written, as before.
   */
  customFieldValues?: Pick<CustomFieldValuePort, 'validateAndMerge'>;
}

/**
 * Whether tax ID X may go on a new organization whose tree's root is `rootId`
 * (`specs/177-tax-id-scope/` research R-7): in `global`, when no row holds X;
 * in `per-tree-root`, when every row holding X is in that tree. Soft-deleted
 * rows count, as both database constraints count them (OD-8).
 */
export async function taxIdAvailableFor(em: EntityManager, taxId: string, rootId: string): Promise<boolean> {
  const scope = await new TaxIdScopeService(() => em).scope(em);
  // Stored values are normalised (`organizations_tax_id_normalised`, OD-11), so
  // one form is compared.
  const normalised = normalizeTaxId(taxId);
  const rows = (await em.execute(
    `select 1 from "organizations"
      where "tax_id" = ?${scope === 'per-tree-root' ? ' and "root_id" is distinct from ?::uuid' : ''}
      limit 1`,
    scope === 'per-tree-root' ? [normalised, rootId] : [normalised],
  )) as unknown[];
  return rows.length === 0;
}

/**
 * What a caller may hand the Command besides the body
 * (`specs/176-command-hooks-outbox/` FR-018): extension input for the hook
 * modules on `organization.create`, keyed by module id. A server-side caller's
 * only — no HTTP field carries it yet (spec 178 decides that).
 */
export interface OrganizationCommandOptions {
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export function makeCreateOrganizationCommand(
  deps: CreateOrganizationCommandDeps,
  input: CreateOrganizationInput,
  options: OrganizationCommandOptions = {},
): Command<Organization> {
  const organizationId = randomUUID();
  const salesChannelIds = [...new Set(input.salesChannelIds)].sort();
  return {
    action: 'organization.create',
    objectType: 'organization',
    objectId: organizationId,
    // `organization.create` is hookable (176 FR-024, `ORGANIZATION_HOOKABLE_ACTIONS.create`).
    ...(options.extensions ? { extensions: options.extensions } : {}),
    hookData: (organization): OrganizationCreateHookData => ({
      organization: toOrganizationRecord(organization),
      salesChannelIds,
    }),
    outboxData: (organization): OrganizationCreateOutbox => ({
      organizationId: organization.id,
      status: organization.status,
    }),
    run: async ({ em, actor }) => {
      let parent: Organization | null = null;
      if (input.parentId !== undefined) {
        parent = await em.findOne(Organization, { id: input.parentId, deletedAt: null });
        if (!parent) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Parent organization not found.');
        if (!deps.tree) throw new Error('organization.create: a parent needs the tree service.');
      }
      // A branch joins its parent's tree; anything else roots a tree of its own.
      const rootId = parent ? parent.path.split('/').filter(Boolean)[0]! : organizationId;
      // D-290 / OD-11 — the canonical form is what is checked and stored.
      const taxId = normalizeTaxId(input.taxId);
      if (!(await taxIdAvailableFor(em, taxId, rootId))) throw taxIdExistsRefusal();
      const customFieldValues = await validatedValues(deps, input);
      const now = new Date();
      const organization = em.create(Organization, {
        id: organizationId,
        name: input.name,
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        taxId,
        status: input.status,
        vatStatus: input.vatStatus ?? 'vat_payer',
        registeredAddress: {
          street: input.registeredAddress.street,
          city: input.registeredAddress.city,
          postalCode: input.registeredAddress.postalCode,
          country: input.registeredAddress.country,
        },
        ...(parent ? { parentId: parent.id, path: `${parent.path}${organizationId}/` } : {}),
        // Created active by an operator is created approved by that operator:
        // the moderation fields say who let it trade, as `approve` would.
        ...(input.status === 'active'
          ? { approvedAt: now, approvedByAdminUserId: actor.actorAdminUserId }
          : {}),
        customFieldValues,
      });
      if (parent) await deps.tree!.assertMaxDepth(em, organization, parent);
      try {
        await em.flush();
      } catch (err) {
        if (taxIdConflictOf(err) !== null) throw taxIdExistsRefusal();
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
          // Names, not values (`specs/conventions/audit-state.md`, D-288, O-2):
          // the name, tax id and address are the tenant's own.
          status: organization.status,
          vatStatus: organization.vatStatus,
          changedFields: presentFields(organization, ORGANIZATION_CREATED_FIELDS),
          salesChannelIds,
          ...(parent ? { parentId: parent.id } : {}),
          // Feature 175 (FR-021) — the keys stored, never their values.
          changedCustomFields: Object.keys(organization.customFieldValues ?? {}).sort(),
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
