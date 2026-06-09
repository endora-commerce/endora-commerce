import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Per-Organization 2FA enforcement flag (feature 042, FR-014). Managed by
 * Organization Administrators (storefront) and Platform Administrators
 * (admin). Owned by the `mfa` module for removability; `organizationId`
 * references the organizations module by value (no hard FK) to preserve
 * module isolation (Constitution Principle I). Absence of a row ⇒ not enforced.
 */
@Entity({ tableName: 'mfa_organization_policies' })
export class MfaOrganizationPolicy {
  [OptionalProps]?: 'id' | 'enforceTotp' | 'updatedByActor' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Unique()
  organizationId!: string;

  @Property({ type: 'boolean' })
  enforceTotp: boolean = false;

  /** Audit hint — admin user id or org-admin customer id that last changed it. */
  @Property({ type: 'string', length: 64, nullable: true })
  updatedByActor?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
