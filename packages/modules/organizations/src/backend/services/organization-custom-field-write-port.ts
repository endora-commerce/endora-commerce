import type {
  OrganizationCustomFieldWriteOptions,
  OrganizationCustomFieldWritePort,
  OrganizationRecord,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  makeSetCustomFieldValuesCommand,
  type OrganizationCustomFieldMerge,
} from '../commands/set-custom-field-values.command.js';
import { toOrganizationRecord } from './organization-details-port.js';

/**
 * `organizationCustomFieldWritePort` — the server-side write of an
 * Organization's custom-field values, for a subscriber, an overlay or an
 * integration worker. The semantics are on the contract
 * (`OrganizationCustomFieldWritePort` in `@endora-commerce/contracts`); this
 * runs them as one `organization.set_custom_field_values` Command and answers
 * the published record, so the entity never leaves the module.
 */
export class OrganizationCustomFieldWriteService implements OrganizationCustomFieldWritePort {
  constructor(private readonly commandBus: CommandBus) {}

  async setCustomFieldValues(
    organizationId: string,
    merge: OrganizationCustomFieldMerge,
    options: OrganizationCustomFieldWriteOptions = {},
  ): Promise<OrganizationRecord> {
    // Extension input for the hook modules on this action (176 FR-018), passed
    // through to the Command, which refuses a key nobody claims.
    const org = await this.commandBus.run(
      makeSetCustomFieldValuesCommand({
        organizationId,
        merge,
        ...(options.extensions ? { extensions: options.extensions } : {}),
      }),
    );
    return toOrganizationRecord(org);
  }
}
