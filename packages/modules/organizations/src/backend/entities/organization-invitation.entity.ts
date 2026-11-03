import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { OrgScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Pending invitation row issued by an Organization Admin.
 * Token rules mirror the email-verification flow: random base64url token
 * shown once, sha256 hash stored. One-shot via `consumed_at`.
 */
@OrgScoped()
@Entity({ tableName: 'organization_invitations' })
export class OrganizationInvitation {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'consumedAt'
    | 'revokedAt'
    | 'role'
    | 'invitedByCustomerAccountId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  @Property({ type: 'uuid', nullable: true })
  invitedByCustomerAccountId?: string | null;

  @Property({ type: 'string', length: 320 })
  @Index()
  email!: string;

  /**
   * The legacy two-value role, kept and **dual-written** beside
   * {@link organizationRoleId} until the feature's legacy-removal package drops
   * it (`specs/170-organization-roles/`, research R-23; migration M4).
   *
   * @deprecated Read `organizationRoleId`.
   */
  @Property({ type: 'string', length: 32 })
  role: 'organization_admin' | 'regular_user' = 'regular_user';

  /**
   * The role the invitee will hold (`specs/170-organization-roles/`, data-model
   * §3). A composite foreign key `(organization_id, organization_role_id)` into
   * `organization_roles`, so it can only name a role of this invitation's own
   * Organization, and a role an invitation still names cannot be deleted. A raw
   * insert that names none is filled from `role` by migration M2's `before
   * insert` trigger.
   */
  @Property({ type: 'uuid' })
  organizationRoleId!: string;

  @Property({ type: 'string', length: 128 })
  @Unique()
  tokenHash!: string;

  @Property({ type: 'datetime' })
  @Index()
  expiresAt!: Date;

  @Property({ type: 'datetime', nullable: true })
  consumedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  revokedAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
