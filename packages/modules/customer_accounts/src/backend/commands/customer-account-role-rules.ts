import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type OrganizationRoleReadPort,
  type OrganizationRoleSummary,
} from '@endora-commerce/contracts';
import type { AuditState } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { CustomerAccount } from '../entities/customer-account.entity.js';

/**
 * What the three member Commands share — `customer_account.change_role`,
 * `customer_account.remove_member` and `customer_account.promote_organization_admin`
 * (`specs/170-organization-roles/` WP-02b; `contracts/commands-audit-events.md`
 * §2–§3; research R-22, R-23, R-29, R-32).
 *
 * The persistence is a seam ({@link CustomerAccountRoleStore}) so the rules are
 * unit-tested with an in-memory store, and so this file is the one place that
 * says how the administrators are locked. Every store method runs on the
 * Command's transactional `EntityManager` (Principle XIII). The roles
 * themselves are `organizations`' — read through {@link OrganizationRoleLookup}.
 */

/** The mutable shape of an account row these Commands write. {@link CustomerAccount} satisfies it. */
export interface CustomerAccountRoleRow {
  id: string;
  organizationId: string;
  organizationRoleId: string;
  deletedAt?: Date | null;
}

export interface CustomerAccountRoleStore {
  /**
   * The account, if it is a member of `organizationId` — a live one, unless
   * `includeRemoved` also admits a soft-deleted one; otherwise `null`.
   */
  findMember(
    organizationId: string,
    customerAccountId: string,
    options?: { includeRemoved?: boolean },
  ): Promise<CustomerAccountRoleRow | null>;
  /**
   * The ids of the Organization's **active** holders of `roleId` (neither
   * blocked nor removed), locked `for update` for the rest of the Command and
   * taken in id order, so two Commands locking one Organization's administrators
   * queue rather than deadlock (research R-29).
   */
  lockActiveHolders(organizationId: string, roleId: string): Promise<string[]>;
  save(row: CustomerAccountRoleRow): Promise<void>;
}

/** The role facts these Commands need — a narrowing of `organizationRoleReadPort`. */
export type OrganizationRoleLookup = Pick<OrganizationRoleReadPort, 'findRole' | 'predefinedRoleId'>;

export interface CustomerAccountRoleCommandDeps {
  readonly roles: OrganizationRoleLookup;
  readonly store: (em: EntityManager) => CustomerAccountRoleStore;
}

export function memberNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'Member not found.');
}

/**
 * The audit snapshot of the account's role (R-32): `{ id, name, kind }`, with
 * `name` and `kind` `null` for a role the lookup no longer finds.
 */
export async function roleSnapshot(
  roles: OrganizationRoleLookup,
  organizationId: string,
  roleId: string,
): Promise<{ id: string; name: string | null; kind: OrganizationRoleSummary['kind'] | null }> {
  const role = await roles.findRole(organizationId, roleId);
  return { id: roleId, name: role?.name ?? null, kind: role?.kind ?? null };
}

export function memberState(
  customerAccountId: string,
  role: { id: string; name: string | null; kind: OrganizationRoleSummary['kind'] | null },
): AuditState {
  return { customerAccountId, role };
}

/**
 * The last-administrator guard, race-free (research R-29;
 * `contracts/commands-audit-events.md` §3): when `account` holds the
 * Organization's *Administrator*, lock every active holder of that role
 * **before** counting, and refuse when none would remain but `account`.
 * A second Command doing the same waits on the lock, then counts the first
 * one's committed outcome.
 */
export async function refuseLosingLastAdministrator(
  deps: CustomerAccountRoleCommandDeps,
  store: CustomerAccountRoleStore,
  account: CustomerAccountRoleRow,
  refusal: () => HttpError,
): Promise<void> {
  const administratorRoleId = await deps.roles.predefinedRoleId(account.organizationId, 'administrator');
  if (account.organizationRoleId !== administratorRoleId) return;
  const holders = await store.lockActiveHolders(account.organizationId, administratorRoleId);
  if (holders.filter((id) => id !== account.id).length === 0) throw refusal();
}

/** A domain-event envelope (`EventBase`). */
export function eventEnvelope(): { eventId: string; occurredAt: string } {
  return { eventId: randomUUID(), occurredAt: new Date().toISOString() };
}

/** The store over a Command's `EntityManager`. */
export function entityManagerAccountRoleStore(em: EntityManager): CustomerAccountRoleStore {
  // command-coverage-ignore: the account writes below run only inside the three
  // member Commands, on the `em` the bus handed them, and the bus records each
  // Command's one audit entry; this factory is their persistence.
  return {
    async findMember(organizationId, customerAccountId, options = {}) {
      return em.findOne(CustomerAccount, {
        id: customerAccountId,
        organizationId,
        ...(options.includeRemoved ? {} : { deletedAt: null }),
      });
    },
    async lockActiveHolders(organizationId, roleId) {
      const rows = (await em.execute(
        `select "id" from "customer_accounts"
          where "organization_id" = ? and "organization_role_id" = ?
            and "deleted_at" is null and "blocked_at" is null
          order by "id"
          for update`,
        [organizationId, roleId],
      )) as Array<{ id: string }>;
      return rows.map((row) => row.id);
    },
    async save() {
      await em.flush();
    },
  };
}
