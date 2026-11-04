import { ArrayType, Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { OrgScoped } from '@endora-commerce/platform/tenancy';
import type { OrganizationRoleKind } from '@endora-commerce/contracts';
import { randomUUID } from 'crypto';

/**
 * A role an Organization's member holds (`specs/170-organization-roles/`,
 * data-model §1; research R-3, R-17).
 *
 * Every Organization has exactly one `administrator` row and one `member` row,
 * created in the Organization's own insert by the `after insert` trigger of
 * migration M2 (research R-28), and up to fifty `custom` ones. The
 * administrator stores nothing: it holds every present organization permission
 * as a wildcard. *Member* stores its explicit grants plus
 * `memberDefaultsOffered`, the member-default codes it has already been offered,
 * which is what lets a newly declared default reach it with no write and lets an
 * un-ticked default stay un-ticked (R-17).
 *
 * Organization-scoped (Principle XI): read through the global filter, so a
 * request naming another Organization's role finds nothing (FR-005); the
 * composite `unique (organization_id, id)` is what the assignment foreign keys
 * reference, so a cross-Organization assignment is refused by the database too.
 *
 * Written only by the `organization_role.*` Commands (Principle XIII). The
 * predefined rows' names are i18n keys, never stored text (FR-003), so `name` is
 * `null` for them.
 */
@OrgScoped()
@Entity({ tableName: 'organization_roles' })
export class OrganizationRole {
  [OptionalProps]?:
    | 'id'
    | 'name'
    | 'nameNormalized'
    | 'description'
    | 'permissions'
    | 'memberDefaultsOffered'
    | 'version'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  @Property({ type: 'text' })
  kind!: OrganizationRoleKind;

  /** The stored name of a `custom` role; `null` for the two predefined ones. */
  @Property({ type: 'string', length: 80, nullable: true })
  name: string | null = null;

  /** `lower(btrim(name))`, written by the Command for the uniqueness rule (FR-004). */
  @Property({ type: 'string', length: 80, nullable: true })
  nameNormalized: string | null = null;

  @Property({ type: 'string', length: 500, nullable: true })
  description: string | null = null;

  /** Granted codes, sorted and unique. Always empty for `administrator` (wildcard). */
  @Property({ type: ArrayType, columnType: 'text[]' })
  permissions: string[] = [];

  /** The per-*Member* first-seen ledger (R-17). Unused for the other kinds. */
  @Property({ type: ArrayType, columnType: 'text[]' })
  memberDefaultsOffered: string[] = [];

  /** Optimistic concurrency for role writes (R-29) — compared by the Command, not by the ORM. */
  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
