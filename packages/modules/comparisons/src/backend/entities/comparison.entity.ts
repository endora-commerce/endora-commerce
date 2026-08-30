import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { CustomerScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

export type ComparisonDisplayMode = 'all' | 'common' | 'differences';

/**
 * Comparison — feature 007 / T011 / data-model.md §1.1.
 *
 * A customer-owned set of product references with a chosen display mode,
 * an owner (customer account or anonymous browser session), an associated
 * sales channel, and a stable shareable URL token. Owner is *exclusively*
 * one of the two — the DB CHECK constraint
 * `comparisons_owner_xor_chk` enforces it; the service layer also
 * validates before insert.
 *
 * `displayMode` persists across re-opens so the customer's chosen mode is
 * remembered. The default `'all'` matches spec FR-008.
 *
 * State transitions: live → deleted (hard delete; `comparison_products`
 * cascades). No soft-delete: spec FR-014 requires the share-token endpoint
 * to resolve to a clear "no longer exists" state, which a missing row
 * already satisfies.
 */
@CustomerScoped()
@Entity({ tableName: 'comparisons' })
export class Comparison {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'displayMode'
    | 'customerAccountId'
    | 'organizationId'
    | 'anonymousToken';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 32 })
  @Unique()
  shareToken!: string;

  /**
   * Set when the owner is authenticated. Mutually exclusive with
   * `anonymousToken` (DB CHECK + service-side guard).
   */
  @Property({ type: 'uuid', nullable: true })
  customerAccountId?: string | null;

  /**
   * The organisation that owns this comparison — feature 087 Group B, ruling
   * D-187.
   *
   * Derived from {@link customerAccountId}'s account and stamped at the write,
   * never resolved on read: `customerOrganizationColumn` asks the ORM's own
   * metadata whether this property exists, so its presence is what makes
   * `customerFilterCond`'s `allowed-set` arm **grant** on this table rather
   * than refuse it whole. A sales representative assigned to the buyer's
   * organisation sees this row because this column is here.
   *
   * Nullable, and the constraint is an implication rather than an equivalence:
   * `comparisons_organization_attribution_chk` requires an organisation of a
   * row that names an account, and says nothing about a row that names none.
   * An **anonymous** comparison is a representable state (FR-011) — this table
   * enforces the owner XOR, so half of it is anonymous by construction — and
   * who such a row belongs to is R-6's open question, which a constraint must
   * not answer.
   */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  organizationId?: string | null;

  /**
   * Set when the owner is an anonymous browser session. Same encoding as
   * `shareToken` (16 random bytes, base64url) but a separate value so a
   * leaked anonymous-cookie token does not double as a public share link.
   */
  @Property({ type: 'string', length: 32, nullable: true })
  anonymousToken?: string | null;

  @Property({ type: 'uuid' })
  @Index()
  salesChannelId!: string;

  @Property({ type: 'string', length: 16 })
  displayMode: ComparisonDisplayMode = 'all';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
