import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { OrgScoped } from '../../../tenancy/org-scoped.decorator.js';
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

  @Property({ type: 'string', length: 32 })
  role: 'organization_admin' | 'regular_user' = 'regular_user';

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
