import type {
  CustomerAccountReadPort,
  OrganizationCommandPort,
  OrganizationConvertToCompanyInput,
  OrganizationRecord,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { makeConvertToCompanyCommand } from '../commands/convert-to-company.command.js';
import type { OrganizationRoleCache } from './organization-role-cache.js';
import { runOrganizationWrite, taxIdExistsRefusal } from './organization-write.js';
import { toOrganizationRecord } from './organization-details-port.js';

/**
 * `organizationCommandPort` (`specs/177-tax-id-scope/` `contracts/convert-to-company.md`
 * §4, research R-10) — server-side writes on the Organization aggregate, for
 * admin routes and server code, never for a customer-facing route.
 *
 * Each method is one Command on the bus with the ambient actor, run through
 * `runOrganizationWrite` so a deferred tax-ID refusal at commit is the same
 * 409 as the pre-check's. No VAT validation: the caller triggers one after the
 * conversion resolved if it needs it (D-290 / OD-2).
 */
export class OrganizationCommandService implements OrganizationCommandPort {
  constructor(
    private readonly deps: {
      commandBus: { run<T>(command: Command<T>): Promise<T> };
      accounts: Pick<CustomerAccountReadPort, 'listByOrganization'>;
      roleCache?: Pick<OrganizationRoleCache, 'dropAndAnnounce'>;
    },
  ) {}

  async convertToCompany(
    organizationId: string,
    input: OrganizationConvertToCompanyInput,
  ): Promise<OrganizationRecord> {
    const organization = await runOrganizationWrite(
      this.deps.commandBus,
      makeConvertToCompanyCommand({ accounts: this.deps.accounts }, { organizationId, input }),
      () => taxIdExistsRefusal(),
    );
    await this.deps.roleCache?.dropAndAnnounce(organization.id);
    return toOrganizationRecord(organization);
  }
}
