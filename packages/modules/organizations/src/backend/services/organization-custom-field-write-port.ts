import type {
  OrganizationCommandPort,
  OrganizationCustomFieldWriteOptions,
  OrganizationCustomFieldWritePort,
  OrganizationRecord,
} from '@endora-commerce/contracts';
import type { OrganizationCustomFieldMerge } from '../commands/set-custom-field-values.command.js';

/**
 * `organizationCustomFieldWritePort` — **deprecated since 0.113.0**
 * (`specs/186-aggregate-ports/` T031): the server-side write of an
 * Organization's custom-field values delegates to
 * `organizationCommandPort.setCustomFieldValues`, which runs the same
 * `organization.set_custom_field_values` Command, so the entry, the merge
 * semantics and the refusals on the contract (`OrganizationCustomFieldWritePort`
 * in `@endora-commerce/contracts`) are unchanged.
 */
export class OrganizationCustomFieldWriteService implements OrganizationCustomFieldWritePort {
  constructor(private readonly commands: Pick<OrganizationCommandPort, 'setCustomFieldValues'>) {}

  setCustomFieldValues(
    organizationId: string,
    merge: OrganizationCustomFieldMerge,
    options: OrganizationCustomFieldWriteOptions = {},
  ): Promise<OrganizationRecord> {
    // Extension input for the hook modules on this action (176 FR-018), passed
    // through; the bus refuses a key nobody claims.
    return this.commands.setCustomFieldValues(
      organizationId,
      merge,
      options.extensions ? { extensions: options.extensions } : {},
    );
  }
}
