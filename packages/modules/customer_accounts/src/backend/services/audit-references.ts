import type { AuditReferenceRegistryPort } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CustomerAccount } from '../entities/customer-account.entity.js';

/**
 * What a customer is called on an audit row (feature 075, D-87 drain).
 *
 * `audit_logs` used to answer this with a `customer_accounts left join
 * organizations` written into its own service — one statement crossing two
 * module boundaries. The answer is this module's now, pushed into the reader's
 * registry.
 *
 * **The label names the person** — `<first> <last> (<e-mail>)`, or the e-mail
 * alone when the account has no name (owner ruling on PR #744, issue #741). It
 * used to be the Organization's name, which says nothing in an Organization's
 * own history: every member's change there read as the Organization. One
 * label serves both readers of this type — a customer acting for themselves
 * on the storefront, and the customer an admin impersonated.
 *
 * No `url`: an audit actor is a person, not a row the card links to. That was
 * already true of the SQL this replaces.
 */
export function registerCustomerAccountAuditReferences(
  registry: AuditReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'customer_accounts',
    referenceType: 'customer_account',
    resolve: async (ids) => {
      const accounts = await emFactory().find(
        CustomerAccount,
        { id: { $in: [...ids] } },
        { fields: ['id', 'email', 'firstName', 'lastName'] },
      );
      return accounts.map((account) => ({
        id: account.id,
        label: personLabel(account),
        url: null,
      }));
    },
  });
}

function personLabel(account: Pick<CustomerAccount, 'email' | 'firstName' | 'lastName'>): string {
  const name = [account.firstName, account.lastName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ');
  return name.length > 0 ? `${name} (${account.email})` : account.email;
}
