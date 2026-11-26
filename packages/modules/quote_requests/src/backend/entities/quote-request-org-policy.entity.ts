import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { OrgScoped } from '@endora-commerce/platform/tenancy';

/**
 * QuoteRequestOrgPolicy — whether members of an organization may propose
 * prices on quote requests (feature 146, US4, data-model §5).
 *
 * One row per organization, keyed by `organizationId`; **no row means
 * allowed** (the default). Written only by the
 * `quote_request_policy.organization.set` Command after its authority check, as
 * find, then create or assign — never `em.upsert` / `nativeUpdate` (threat
 * model T2), so the org write guard sees the row at flush.
 *
 * `@OrgScoped()` governs the admin reads (research R10): a buyer reads their
 * own organization's row, a scoped sales representative the rows of the
 * organizations they may see. **Enforcement does not rely on the filter**:
 * the lock is read by exact primary key under a named system scope in the
 * writing request (research R11, threat model T1), because a filtered read can
 * turn an existing lock into "no row", which would read as "allowed".
 */
@OrgScoped()
@Entity({ tableName: 'quote_request_org_policies' })
export class QuoteRequestOrgPolicy {
  [OptionalProps]?: 'priceProposalsAllowed' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  organizationId!: string;

  /** `false` = members may not propose prices. */
  @Property({ type: 'boolean', default: true })
  priceProposalsAllowed: boolean = true;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
