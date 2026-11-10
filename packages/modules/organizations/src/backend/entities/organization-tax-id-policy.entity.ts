import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import type { TaxIdScope } from '@endora-commerce/contracts';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * `specs/177-tax-id-scope/` data-model §2 — the installation's tax-ID scope,
 * one row (`id` is `true`, held by a check).
 *
 * A row in this module's own table rather than a Setting because the scope and
 * the database constraint enforcing it must change in **one** transaction
 * (research R-4): `organization.tax_id_scope.set` swaps the constraint and
 * updates this row together, and every write path reads it inside its own
 * transaction, so there is no cache to go stale. Platform-global by nature —
 * one scope per installation — hence `@GlobalEntity()`.
 *
 * Seeded `global` by the `tax_id_scope` migration; never written by anything but
 * the scope Command.
 */
@GlobalEntity()
@Entity({ tableName: 'organization_tax_id_policy' })
export class OrganizationTaxIdPolicy {
  [OptionalProps]?: 'id' | 'scope' | 'updatedAt' | 'updatedByAdminUserId';

  @PrimaryKey({ type: 'boolean' })
  id: boolean = true;

  @Property({ type: 'text' })
  scope: TaxIdScope = 'global';

  @Property({ type: 'datetime' })
  updatedAt: Date = new Date();

  /** The actor of the last change; `null` from the migration's seed. */
  @Property({ type: 'uuid', nullable: true })
  updatedByAdminUserId?: string | null;
}
