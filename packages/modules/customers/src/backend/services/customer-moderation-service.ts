import {
  ERROR_CODES,
  type CustomerAccountCommandPort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { CustomerAuthorityService } from './customer-authority-service.js';

/**
 * CustomerModerationService — block / unblock a Customer account (feature 040,
 * US3). Enforces the staff-authority rules (FR-013/FR-015 via
 * CustomerAuthorityService), then runs `customer_accounts`' Command.
 *
 * **Feature 075, Phase C — the row is `customer_accounts`'.** Since
 * `specs/186-aggregate-ports/` (issue #1822) the write is
 * `customerAccountCommandPort.block` / `.unblock`: the Command records the
 * `customer_account.blocked` / `.unblocked` entry in the write's transaction,
 * refuses to strand a company Organization without an administrator
 * (`409 ORG_OWNER_DEPLETION`, counted under a lock), and ends the account's
 * sessions after its commit — all three used to be done here, around a port
 * call, which a server-side caller of the port did not get. What stays is the
 * *decision* this module owns: whether this staff member may act on this
 * customer.
 */
export interface ModerationActor {
  adminUserId: string;
  isPlatformAdmin: boolean;
}

export interface BlockCustomerInput {
  targetCustomerAccountId: string;
  actor: ModerationActor;
  reason?: string | null;
}

export interface UnblockCustomerInput {
  targetCustomerAccountId: string;
  actor: ModerationActor;
}

export class CustomerModerationService {
  constructor(
    private readonly accounts: CustomerAccountReadPort,
    private readonly commands: Pick<CustomerAccountCommandPort, 'block' | 'unblock'>,
    private readonly authority: CustomerAuthorityService,
  ) {}

  async block(input: BlockCustomerInput): Promise<CustomerAccountRecord> {
    const customer = await this.loadActive(input.targetCustomerAccountId);
    await this.assertAuthorized(input.actor, customer);

    if (customer.blockedAt) return customer; // idempotent

    // The Command refuses the last company administrator and ends the
    // account's sessions once the block has committed (SC-002).
    return this.commands.block(customer.id, { reason: input.reason ?? null });
  }

  async unblock(input: UnblockCustomerInput): Promise<CustomerAccountRecord> {
    const customer = await this.loadActive(input.targetCustomerAccountId);
    await this.assertAuthorized(input.actor, customer);

    if (!customer.blockedAt) return customer; // idempotent

    return this.commands.unblock(customer.id);
  }

  private async loadActive(id: string): Promise<CustomerAccountRecord> {
    const customer = await this.accounts.findById(id, { activeOnly: true });
    if (!customer) {
      throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
    }
    return customer;
  }

  private async assertAuthorized(
    actor: ModerationActor,
    customer: CustomerAccountRecord,
  ): Promise<void> {
    const allowed = await this.authority.canManageCustomer({
      isPlatformAdmin: actor.isPlatformAdmin,
      adminUserId: actor.adminUserId,
      customerOrganizationId: customer.organizationId,
    });
    if (!allowed) {
      throw new HttpError(
        403,
        ERROR_CODES.FORBIDDEN,
        'You are not allowed to manage this customer.',
      );
    }
  }
}
