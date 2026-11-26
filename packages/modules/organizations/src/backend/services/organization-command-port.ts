import type { EntityManager } from '@mikro-orm/postgresql';
import type { ZodType } from 'zod';
import {
  assignOrganizationParentRequestSchema,
  assignSalesRepRequestSchema,
  ERROR_CODES,
  OrganizationSalesChannelsUpdateBodySchema,
  setCreditInheritanceModeRequestSchema,
  type AdminUserReadPort,
  type AggregateCommandOptions,
  type CreditInheritanceMode,
  type CustomerAccountReadPort,
  type CustomFieldMerge,
  type CustomFieldValuePort,
  type DictionaryValidator,
  type OrganizationAllowListKind,
  type OrganizationAllowListPatch,
  type OrganizationAllowListsReplace,
  type OrganizationBlockInput,
  type OrganizationChangeTaxIdInput,
  type OrganizationCommandPort,
  type OrganizationConvertToCompanyInput,
  type OrganizationRecord,
  type OrganizationRejectInput,
  type OrganizationRestrictions,
  type OrganizationSalesChannelsUpdateBody,
  type OrganizationWriteCreateInput,
  type OrganizationWriteUpdatePatch,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { assertCallerSource, withCallerOptions, type CallerOptions } from '../commands/caller-options.js';
import { makeChangeTaxIdCommand } from '../commands/change-tax-id.command.js';
import { makeConvertToCompanyCommand } from '../commands/convert-to-company.command.js';
import { makeCreateOrganizationCommand } from '../commands/create-organization.command.js';
import { makeDeleteOrganizationCommand } from '../commands/delete-organization.command.js';
import { makeAssignSalesRepCommand, makeUnassignSalesRepCommand } from '../commands/sales-rep-assignment.commands.js';
import { makeSetCreditModeCommand } from '../commands/set-credit-mode.command.js';
import { makeSetCustomFieldValuesCommand } from '../commands/set-custom-field-values.command.js';
import { makeSetSalesChannelsCommand } from '../commands/set-sales-channels.command.js';
import { makePlaceInTreeCommand } from '../commands/set-parent.command.js';
import { makeUpdateOrganizationCommand } from '../commands/update-organization.command.js';
import type { Organization } from '../entities/organization.entity.js';
import {
  blockOrganizationSchema,
  organizationWriteCreateInputSchema,
  organizationWriteUpdateOptionsSchema,
  organizationWriteUpdatePatchSchema,
  patchOrgRestrictionsSchema,
  rejectOrganizationSchema,
  replaceOrgRestrictionsSchema,
} from '../schemas/organization.js';
import { toOrganizationRecord } from './organization-details-port.js';
import {
  OrganizationNotFoundError,
  OrganizationStatusGuardError,
  OrganizationVersionMismatchError,
} from './organization-moderation-errors.js';
import type { OrganizationModerationService } from './organization-moderation-service.js';
import { moderationHttpError } from './organization-refusals.js';
import type { OrganizationRestrictionService, RestrictionKind } from './organization-restriction-service.js';
import type { OrganizationRoleCache } from './organization-role-cache.js';
import { taxIdSharedAcrossTreesRefusal, type OrganizationTreeService } from './organization-tree-service.js';
import { runOrganizationWrite, taxIdExistsRefusal } from './organization-write.js';
import { assertCountryAvailable, assertSalesChannelsExist } from './organization-write-guards.js';

/**
 * `organizationCommandPort` (`specs/186-aggregate-ports/` US1, issue #1821) —
 * the Organization aggregate's write port. The contract, the refusals and the
 * options are `OrganizationCommandPort` in `@endora-commerce/contracts`.
 *
 * **It checks no permission.** The caller is the gate. Each method validates
 * `source` before it reads anything (issue #1922), parses its input with the
 * admin route's schema (a refusal is `422 VALIDATION_FAILED`), and runs the
 * Command factory the route runs — through the route's own runner where it has
 * one: the moderation and restriction services, `runOrganizationWrite` for the
 * writes of the tax-ID and tree columns. The caller's `source` and
 * `extensions` are added to that Command by `withCallerOptions`, never by a
 * second factory.
 *
 * The moderation, version and status refusals are the route's HTTP errors
 * (`organization-refusals.ts`); only the reader-language status labels are the
 * route's alone.
 */

export interface OrganizationCommandServiceDeps {
  readonly commandBus: Pick<CommandBus, 'run'>;
  readonly accounts: Pick<CustomerAccountReadPort, 'listByOrganization'>;
  readonly roleCache?: Pick<OrganizationRoleCache, 'dropAndAnnounce'> | undefined;
  /** What every method but `convertToCompany` and `changeTaxId` needs; absent only in a narrow unit test. */
  readonly aggregate?: OrganizationAggregateDeps | undefined;
}

/** The aggregate's other operations' dependencies, each resolved per call by the composition. */
export interface OrganizationAggregateDeps {
  readonly emFactory: () => EntityManager;
  /**
   * Kernel-provided; binds a created Organization's channels in the creating
   * transaction, and replaces them inside `organization.sales_channels.set`.
   */
  readonly membership: Pick<SalesChannelMembershipPort, 'replaceChannelsForEntity' | 'listChannelsForEntity'>;
  readonly dictionaryValidator: Pick<DictionaryValidator, 'validateCountryCode'>;
  readonly tree: OrganizationTreeService;
  readonly customFieldValues: Pick<CustomFieldValuePort, 'validateAndMerge'>;
  readonly moderation: () => Pick<OrganizationModerationService, 'approve' | 'reject' | 'block' | 'unblock'>;
  readonly restrictions: () => Pick<OrganizationRestrictionService, 'replaceAllowLists' | 'patchAllowList'>;
  readonly adminUsers: Pick<AdminUserReadPort, 'findById'>;
}

/** The admin bodies without their version, which travels as `options.expectedVersion`. */
const rejectInputSchema = rejectOrganizationSchema.omit({ expectedVersion: true });
const blockInputSchema = blockOrganizationSchema.omit({ expectedVersion: true });
const replaceInputSchema = replaceOrgRestrictionsSchema.omit({ expectedVersion: true });
const patchInputSchema = patchOrgRestrictionsSchema.omit({ expectedVersion: true });
const expectedVersionSchema = organizationWriteUpdateOptionsSchema.shape.expectedVersion;

/** The published allow-list kinds, as the three `PATCH …/restrictions/*` routes name them. */
const RESTRICTION_KIND: Readonly<Record<OrganizationAllowListKind, RestrictionKind>> = {
  paymentMethodIds: 'payment_method',
  deliveryMethodIds: 'delivery_method',
  warehouseIds: 'warehouse',
};

/**
 * Parses a port input with the admin route's schema; a refusal is the
 * platform's `422 VALIDATION_FAILED` with a field error per issue.
 */
export function parseOrRefuse<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new HttpError(
    422,
    ERROR_CODES.VALIDATION_FAILED,
    'The Organization write is invalid.',
    parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), issue: issue.message })),
  );
}

export class OrganizationCommandService implements OrganizationCommandPort {
  constructor(private readonly deps: OrganizationCommandServiceDeps) {}

  async create(input: OrganizationWriteCreateInput, options: AggregateCommandOptions = {}): Promise<OrganizationRecord> {
    const caller = callerOf(options);
    const body = parseOrRefuse(organizationWriteCreateInputSchema, input);
    const deps = this.#aggregate();
    // The admin create's own checks, in its order (`organization-write-guards.ts`).
    await assertCountryAvailable(deps.dictionaryValidator, body.registeredAddress.country);
    // R-16.5 — the code the deprecated `organizationWritePort.create` answers.
    await assertSalesChannelsExist(deps.emFactory(), body.salesChannelIds, ERROR_CODES.UNKNOWN_SALES_CHANNEL);
    const organization = await runOrganizationWrite(
      this.deps.commandBus,
      withCallerOptions(
        makeCreateOrganizationCommand(
          { membership: deps.membership, tree: deps.tree, customFieldValues: deps.customFieldValues },
          body,
        ),
        caller,
      ),
      () => taxIdExistsRefusal(),
    );
    return toOrganizationRecord(organization);
  }

  async update(
    id: string,
    patch: OrganizationWriteUpdatePatch,
    options: AggregateCommandOptions = {},
  ): Promise<OrganizationRecord> {
    const caller = callerOf(options);
    const parsedPatch = parseOrRefuse(organizationWriteUpdatePatchSchema, patch);
    const expectedVersion = parseOrRefuse(expectedVersionSchema, options.expectedVersion);
    const deps = this.#aggregate();
    const organization = await runOrganizationWrite(
      this.deps.commandBus,
      withCallerOptions(
        makeUpdateOrganizationCommand(
          { validateCountry: (code, mode) => assertCountryAvailable(deps.dictionaryValidator, code, mode) },
          { organizationId: id, patch: parsedPatch, ...(expectedVersion !== undefined ? { expectedVersion } : {}) },
        ),
        caller,
      ),
    );
    return toOrganizationRecord(organization);
  }

  async setParent(
    id: string,
    input: { readonly parentId: string | null },
    options: AggregateCommandOptions = {},
  ): Promise<OrganizationRecord> {
    const caller = callerOf(options);
    const { parentId } = parseOrRefuse(assignOrganizationParentRequestSchema, input);
    const deps = this.#aggregate();
    // A read, not a write: which of the two actions applies (R-16.3).
    const command = await makePlaceInTreeCommand(deps.emFactory(), { tree: deps.tree }, { organizationId: id, parentId });
    // The deferred `per-tree-root` constraint answers at commit as the route answers it.
    const organization = await runOrganizationWrite(this.deps.commandBus, withCallerOptions(command, caller), () =>
      taxIdSharedAcrossTreesRefusal([]),
    );
    return toOrganizationRecord(organization);
  }

  async approve(id: string, options: AggregateCommandOptions = {}): Promise<OrganizationRecord> {
    const caller = callerOf(options);
    const expectedVersion = parseOrRefuse(expectedVersionSchema, options.expectedVersion);
    const moderation = this.#aggregate().moderation();
    return transitioned(() => moderation.approve(id, { expectedVersion, ...caller }));
  }

  async reject(id: string, input: OrganizationRejectInput, options: AggregateCommandOptions = {}): Promise<OrganizationRecord> {
    const caller = callerOf(options);
    const { reason, notifyCustomerEmail } = parseOrRefuse(rejectInputSchema, input);
    const expectedVersion = parseOrRefuse(expectedVersionSchema, options.expectedVersion);
    const moderation = this.#aggregate().moderation();
    return transitioned(() => moderation.reject(id, { expectedVersion, reason, notifyCustomerEmail, ...caller }));
  }

  async block(id: string, input: OrganizationBlockInput, options: AggregateCommandOptions = {}): Promise<OrganizationRecord> {
    const caller = callerOf(options);
    const { reason } = parseOrRefuse(blockInputSchema, input ?? {});
    const expectedVersion = parseOrRefuse(expectedVersionSchema, options.expectedVersion);
    const moderation = this.#aggregate().moderation();
    return transitioned(() => moderation.block(id, { expectedVersion, reason: reason ?? null, ...caller }));
  }

  async unblock(id: string, options: AggregateCommandOptions = {}): Promise<OrganizationRecord> {
    const caller = callerOf(options);
    const expectedVersion = parseOrRefuse(expectedVersionSchema, options.expectedVersion);
    const moderation = this.#aggregate().moderation();
    return transitioned(() => moderation.unblock(id, { expectedVersion, ...caller }));
  }

  async delete(id: string, options: AggregateCommandOptions = {}): Promise<void> {
    const caller = callerOf(options);
    await this.deps.commandBus.run(withCallerOptions(makeDeleteOrganizationCommand({ organizationId: id }), caller));
  }

  async setCustomFieldValues(
    id: string,
    merge: CustomFieldMerge,
    options: AggregateCommandOptions = {},
  ): Promise<OrganizationRecord> {
    const caller = callerOf(options);
    const organization = await this.deps.commandBus.run(
      withCallerOptions(makeSetCustomFieldValuesCommand({ organizationId: id, merge }), caller),
    );
    return toOrganizationRecord(organization);
  }

  async convertToCompany(
    organizationId: string,
    input: OrganizationConvertToCompanyInput,
    options: AggregateCommandOptions = {},
  ): Promise<OrganizationRecord> {
    const caller = callerOf(options);
    // Extension input for the hook modules on the action (176 FR-018, #1057);
    // the bus refuses a key nobody claims.
    const organization = await runOrganizationWrite(
      this.deps.commandBus,
      withCallerOptions(makeConvertToCompanyCommand({ accounts: this.deps.accounts }, { organizationId, input }), caller),
      () => taxIdExistsRefusal(),
    );
    // Committed by now: a cache that cannot be dropped is logged, not a failure.
    await this.deps.roleCache?.dropAndAnnounce(organization.id).catch((err: unknown) => {
      console.warn(`organizations: role cache not dropped after converting ${organization.id}`, err);
    });
    return toOrganizationRecord(organization);
  }

  /**
   * Issue #1040 — `organization.tax_id.change`. A same-value call answers the
   * record unchanged; nothing is emitted for it, and nothing is audited unless a
   * command hook noted a write of its own.
   */
  async changeTaxId(
    organizationId: string,
    input: OrganizationChangeTaxIdInput,
    options: AggregateCommandOptions = {},
  ): Promise<OrganizationRecord> {
    const caller = callerOf(options);
    const { organization } = await runOrganizationWrite(
      this.deps.commandBus,
      withCallerOptions(makeChangeTaxIdCommand({ organizationId, input }), caller),
      () => taxIdExistsRefusal(),
    );
    return toOrganizationRecord(organization);
  }

  async setSalesChannels(
    id: string,
    input: OrganizationSalesChannelsUpdateBody,
    options: AggregateCommandOptions = {},
  ): Promise<OrganizationRecord> {
    const caller = callerOf(options);
    const { salesChannelIds } = parseOrRefuse(OrganizationSalesChannelsUpdateBodySchema, input);
    const { membership } = this.#aggregate();
    const organization = await this.deps.commandBus.run(
      withCallerOptions(
        makeSetSalesChannelsCommand(
          { membership },
          // R-16.5 — the code the deprecated `organizationWritePort.create` answers.
          { organizationId: id, salesChannelIds, unknownChannelCode: ERROR_CODES.UNKNOWN_SALES_CHANNEL },
        ),
        caller,
      ),
    );
    return toOrganizationRecord(organization);
  }

  async setRestrictions(
    id: string,
    input: OrganizationAllowListsReplace,
    options: AggregateCommandOptions = {},
  ): Promise<OrganizationRestrictions> {
    const caller = callerOf(options);
    const lists = parseOrRefuse(replaceInputSchema, input);
    const expectedVersion = parseOrRefuse(expectedVersionSchema, options.expectedVersion);
    const restrictions = this.#aggregate().restrictions();
    return refusedAsRoute(() => restrictions.replaceAllowLists(id, { ...lists, expectedVersion }, caller));
  }

  async patchRestriction(
    id: string,
    kind: OrganizationAllowListKind,
    patch: OrganizationAllowListPatch,
    options: AggregateCommandOptions = {},
  ): Promise<OrganizationRestrictions> {
    const caller = callerOf(options);
    const restrictionKind = Object.hasOwn(RESTRICTION_KIND, kind) ? RESTRICTION_KIND[kind] : undefined;
    if (restrictionKind === undefined) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The Organization write is invalid.', [
        { path: 'kind', issue: 'Expected paymentMethodIds, deliveryMethodIds or warehouseIds.' },
      ]);
    }
    const body = parseOrRefuse(patchInputSchema, patch ?? {});
    const expectedVersion = parseOrRefuse(expectedVersionSchema, options.expectedVersion);
    const restrictions = this.#aggregate().restrictions();
    return refusedAsRoute(() => restrictions.patchAllowList(id, restrictionKind, { ...body, expectedVersion }, caller));
  }

  async setCreditInheritanceMode(
    id: string,
    input: { readonly mode: CreditInheritanceMode | null },
    options: AggregateCommandOptions = {},
  ): Promise<OrganizationRecord> {
    const caller = callerOf(options);
    const { mode } = parseOrRefuse(setCreditInheritanceModeRequestSchema, input);
    const organization = await this.deps.commandBus.run(
      withCallerOptions(makeSetCreditModeCommand({ organizationId: id, mode }), caller),
    );
    return toOrganizationRecord(organization);
  }

  async assignSalesRep(
    id: string,
    input: { readonly adminUserId: string },
    options: AggregateCommandOptions = {},
  ): Promise<void> {
    const caller = callerOf(options);
    const { adminUserId } = parseOrRefuse(assignSalesRepRequestSchema, input);
    const { adminUsers } = this.#aggregate();
    await this.deps.commandBus.run(
      withCallerOptions(makeAssignSalesRepCommand({ adminUsers }, { organizationId: id, adminUserId }), caller),
    );
  }

  async unassignSalesRep(
    id: string,
    input: { readonly adminUserId: string },
    options: AggregateCommandOptions = {},
  ): Promise<void> {
    const caller = callerOf(options);
    const removed = await this.deps.commandBus.run(
      withCallerOptions(
        makeUnassignSalesRepCommand({ organizationId: id, adminUserId: input?.adminUserId ?? '' }),
        caller,
      ),
    );
    // The admin route's answer for an assignment that is not there.
    if (!removed) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Assignment not found.');
  }

  #aggregate(): OrganizationAggregateDeps {
    if (!this.deps.aggregate) {
      throw new Error('organizationCommandPort: composed without the aggregate dependencies.');
    }
    return this.deps.aggregate;
  }
}

/**
 * The caller's options as the Commands take them. `source` is refused here,
 * first, so nothing is read or written for a malformed one (issue #1922).
 */
function callerOf(options: AggregateCommandOptions): CallerOptions {
  assertCallerSource(options);
  return { source: options.source, extensions: options.extensions };
}

/** A moderation transition, answered as the published record. */
async function transitioned(write: () => Promise<Organization>): Promise<OrganizationRecord> {
  return toOrganizationRecord(await refusedAsRoute(write));
}

/** The moderation and restriction errors as the admin routes answer them; anything else unchanged. */
async function refusedAsRoute<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (
      err instanceof OrganizationVersionMismatchError ||
      err instanceof OrganizationStatusGuardError ||
      err instanceof OrganizationNotFoundError
    ) {
      throw moderationHttpError(err);
    }
    throw err;
  }
}
