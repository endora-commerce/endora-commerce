import type {
  OrganizationCommandPort,
  OrganizationDetailsPort,
  OrganizationRecord,
  OrganizationWriteCreateInput,
  OrganizationWritePort,
  OrganizationWriteUpdateOptions,
  OrganizationWriteUpdatePatch,
} from '@endora-commerce/contracts';
import { organizationWriteUpdateOptionsSchema } from '../schemas/organization.js';
import { parseOrRefuse } from './organization-command-port.js';

export interface OrganizationWriteServiceDeps {
  /** The aggregate port each write delegates to (`specs/186-aggregate-ports/` T031). */
  readonly commands: Pick<OrganizationCommandPort, 'create' | 'update'>;
  /** The read model's tax-ID lookup, so the two ports answer one question one way. */
  readonly lookup: Pick<OrganizationDetailsPort, 'findByTaxId'>;
}

/**
 * `organizationWritePort` (issue #1029) — **deprecated since 0.113.0**
 * (`specs/186-aggregate-ports/` T031). Each method delegates to its
 * replacement, so the entries, the refusals and the actor rules on the
 * contract (`OrganizationWritePort` in `@endora-commerce/contracts`) are
 * exactly what they were: `create` and `update` are
 * `organizationCommandPort.create` / `.update` — the same
 * `organization.create` / `organization.update` Commands, the same checks in
 * the same order, `422 UNKNOWN_SALES_CHANNEL` for an unknown channel — and
 * `findByTaxId` is `organizationDetailsPort.findByTaxId`.
 */
export class OrganizationWriteService implements OrganizationWritePort {
  constructor(private readonly deps: OrganizationWriteServiceDeps) {}

  findByTaxId(taxId: string): Promise<OrganizationRecord[]> {
    return this.deps.lookup.findByTaxId(taxId);
  }

  create(input: OrganizationWriteCreateInput): Promise<OrganizationRecord> {
    return this.deps.commands.create(input);
  }

  async update(
    id: string,
    patch: OrganizationWriteUpdatePatch,
    options: OrganizationWriteUpdateOptions = {},
  ): Promise<OrganizationRecord> {
    // The narrow port's own option shape, refused as it always was.
    const { expectedVersion } = parseOrRefuse(organizationWriteUpdateOptionsSchema, options);
    return this.deps.commands.update(id, patch, expectedVersion !== undefined ? { expectedVersion } : {});
  }
}
