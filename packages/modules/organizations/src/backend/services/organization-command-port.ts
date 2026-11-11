import type {
  CustomerAccountReadPort,
  OrganizationChangeTaxIdInput,
  OrganizationCommandPort,
  OrganizationConvertToCompanyInput,
  OrganizationRecord,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { makeChangeTaxIdCommand } from '../commands/change-tax-id.command.js';
import { makeConvertToCompanyCommand } from '../commands/convert-to-company.command.js';
import type { OrganizationRoleCache } from './organization-role-cache.js';
import { runOrganizationWrite, taxIdExistsRefusal } from './organization-write.js';
import { toOrganizationRecord } from './organization-details-port.js';

/**
 * `organizationCommandPort` (`specs/177-tax-id-scope/` `contracts/convert-to-company.md`
 * §4, research R-10) — server-side writes on the Organization aggregate, for
 * admin routes and server code, never for a customer-facing route: the
 * personal → company conversion and the tax-ID correction (issue #1040).
 *
 * **It checks no permission.** The caller is the gate: an admin route behind
 * `requireAdmin('organizations:convert-to-company')` (or
 * `organizations:change-tax-id`) and the reach rule, or operator-run server
 * code (an import, a worker under `withSystemScope`). A module that exposes it
 * to anybody else exposes both writes.
 *
 * Each method is one Command on the bus with the ambient actor, run through
 * `runOrganizationWrite` so a deferred tax-ID refusal at commit is the same
 * 409 as the pre-check's. No VAT validation: the caller triggers one after the
 * write resolved if it needs it (D-290 / OD-2).
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
    // Committed by now: a cache that cannot be dropped is logged, not a failure.
    await this.deps.roleCache?.dropAndAnnounce(organization.id).catch((err: unknown) => {
      console.warn(`organizations: role cache not dropped after converting ${organization.id}`, err);
    });
    return toOrganizationRecord(organization);
  }

  /**
   * Issue #1040 — `organization.tax_id.change`. A same-value call answers the
   * record unchanged; nothing is audited or emitted for it.
   */
  async changeTaxId(organizationId: string, input: OrganizationChangeTaxIdInput): Promise<OrganizationRecord> {
    const { organization } = await runOrganizationWrite(
      this.deps.commandBus,
      makeChangeTaxIdCommand({ organizationId, input }),
      () => taxIdExistsRefusal(),
    );
    return toOrganizationRecord(organization);
  }
}
