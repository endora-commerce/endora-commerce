import type { AuditReferenceRegistryPort, OrganizationDetailsPort } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CustomerAccount } from '../entities/customer-account.entity.js';

/**
 * What an impersonated customer is called on an audit row (feature 075, D-87
 * drain).
 *
 * `audit_logs` used to answer this with a `customer_accounts left join
 * organizations` written into its own service — one statement crossing two
 * module boundaries. The organisation name is still preferred over the account
 * e-mail, because that is what an operator reading "acted as …" recognises; it
 * comes from `organizationDetailsPort` now, an edge this module already declares
 * and has always had a foreign key for.
 *
 * There is no `catch` around that port on purpose. It is gated, and a gate that
 * says no must not be turned into a blank name here — the reader's own
 * enumeration policy is what degrades this whole bucket, one level up.
 *
 * No `url`: an audit actor is a person, not a row the card links to. That was
 * already true of the SQL this replaces.
 */
export function registerCustomerAccountAuditReferences(
  registry: AuditReferenceRegistryPort,
  emFactory: () => EntityManager,
  organizationDetails: OrganizationDetailsPort,
): void {
  registry.register({
    ownerModuleId: 'customer_accounts',
    referenceType: 'customer_account',
    resolve: async (ids) => {
      const accounts = await emFactory().find(
        CustomerAccount,
        { id: { $in: [...ids] } },
        { fields: ['id', 'email', 'organizationId'] },
      );
      if (accounts.length === 0) return [];

      const organizationIds = [
        ...new Set(accounts.map((a) => a.organizationId).filter((id): id is string => !!id)),
      ];
      const names = new Map<string, string>();
      if (organizationIds.length > 0) {
        for (const org of await organizationDetails.findByIds(organizationIds)) {
          names.set(org.id, org.name);
        }
      }

      return accounts.map((account) => ({
        id: account.id,
        label:
          (account.organizationId ? names.get(account.organizationId) : undefined) ??
          account.email,
        url: null,
      }));
    },
  });
}
