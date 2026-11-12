import type { EntityManager } from '@mikro-orm/postgresql';
import type { ZodType } from 'zod';
import {
  ERROR_CODES,
  type CustomFieldValuePort,
  type DictionaryValidator,
  type OrganizationDetailsPort,
  type OrganizationRecord,
  type OrganizationWriteCreateInput,
  type OrganizationWritePort,
  type OrganizationWriteUpdateOptions,
  type OrganizationWriteUpdatePatch,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { makeCreateOrganizationCommand } from '../commands/create-organization.command.js';
import { makeUpdateOrganizationCommand } from '../commands/update-organization.command.js';
import {
  organizationWriteCreateInputSchema,
  organizationWriteUpdateOptionsSchema,
  organizationWriteUpdatePatchSchema,
} from '../schemas/organization.js';
import { toOrganizationRecord } from './organization-details-port.js';
import type { OrganizationTreeService } from './organization-tree-service.js';
import { runOrganizationWrite, taxIdExistsRefusal } from './organization-write.js';
import { assertCountryAvailable, assertSalesChannelsExist } from './organization-write-guards.js';

export interface OrganizationWriteServiceDeps {
  readonly commandBus: Pick<CommandBus, 'run'>;
  readonly emFactory: () => EntityManager;
  /** Kernel-provided; binds the created Organization's channels in the creating transaction. */
  readonly membership: Pick<SalesChannelMembershipPort, 'replaceChannelsForEntity'>;
  /** `dictionaries`' gated port, resolved per call by the composition. */
  readonly dictionaryValidator: Pick<DictionaryValidator, 'validateCountryCode'>;
  /** The read model's tax-ID lookup, so the two ports answer one question one way. */
  readonly lookup: Pick<OrganizationDetailsPort, 'findByTaxId'>;
  /** The depth bound for a branch, as the admin create passes it. */
  readonly tree: Pick<OrganizationTreeService, 'assertMaxDepth'>;
  /** `custom_fields`' value port, as the admin create passes it. */
  readonly customFieldValues: Pick<CustomFieldValuePort, 'validateAndMerge'>;
}

function parseOrRefuse<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new HttpError(
    422,
    ERROR_CODES.VALIDATION_FAILED,
    'The Organization write is invalid.',
    parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), issue: issue.message })),
  );
}

/**
 * `organizationWritePort` (issue #1029) — find, create and update an
 * Organization's identity and contact fields from another module. The
 * semantics, refusals and actor rules are on the contract
 * (`OrganizationWritePort` in `@endora-commerce/contracts`); this runs the two
 * writes as the `organization.create` and `organization.update` Commands and
 * answers the published record, so the entity never leaves the module.
 *
 * The checks before `create` are the admin create's own
 * (`organization-write-guards.ts`), in the same order: shape (the tax ID
 * normalised by the schema), country, channels. The tax-ID scope, the parent
 * and the custom-field values are the Command's. Both writes go through
 * `runOrganizationWrite`, so `per-tree-root`'s deferred constraint and a lost
 * lock answer their 409s rather than a 500 (`tax-id-write-paths.test.ts`).
 * Naming a parent is not gated here: the caller is the gate, as for
 * `organizationCommandPort`.
 */
export class OrganizationWriteService implements OrganizationWritePort {
  constructor(private readonly deps: OrganizationWriteServiceDeps) {}

  findByTaxId(taxId: string): Promise<OrganizationRecord[]> {
    return this.deps.lookup.findByTaxId(taxId);
  }

  async create(input: OrganizationWriteCreateInput): Promise<OrganizationRecord> {
    const body = parseOrRefuse(organizationWriteCreateInputSchema, input);
    await assertCountryAvailable(this.deps.dictionaryValidator, body.registeredAddress.country);
    await assertSalesChannelsExist(this.deps.emFactory(), body.salesChannelIds, ERROR_CODES.UNKNOWN_SALES_CHANNEL);
    const organization = await runOrganizationWrite(
      this.deps.commandBus,
      makeCreateOrganizationCommand(
        {
          membership: this.deps.membership,
          tree: this.deps.tree,
          customFieldValues: this.deps.customFieldValues,
        },
        body,
      ),
      () => taxIdExistsRefusal(),
    );
    return toOrganizationRecord(organization);
  }

  async update(
    id: string,
    patch: OrganizationWriteUpdatePatch,
    options: OrganizationWriteUpdateOptions = {},
  ): Promise<OrganizationRecord> {
    const parsedPatch = parseOrRefuse(organizationWriteUpdatePatchSchema, patch);
    const { expectedVersion } = parseOrRefuse(organizationWriteUpdateOptionsSchema, options);
    const organization = await runOrganizationWrite(
      this.deps.commandBus,
      makeUpdateOrganizationCommand(
        {
          validateCountry: (code, mode) => assertCountryAvailable(this.deps.dictionaryValidator, code, mode),
        },
        {
          organizationId: id,
          patch: parsedPatch,
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        },
      ),
    );
    return toOrganizationRecord(organization);
  }
}
