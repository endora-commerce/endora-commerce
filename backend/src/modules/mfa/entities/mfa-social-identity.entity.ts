import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Link between a platform account and an external provider identity
 * (Google / Microsoft) — feature 042. Resolution is by the provider's
 * verified primary email; the `providerSubject` (`sub` claim) is the stable
 * provider-side id. Uniqueness constraints (declared in migration 067):
 *   - (provider, provider_subject): one platform account per IdP identity;
 *   - (subject_type, subject_id, provider): one link per provider per account.
 */
@Entity({ tableName: 'mfa_social_identities' })
export class MfaSocialIdentity {
  [OptionalProps]?: 'id' | 'lastUsedAt' | 'linkedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 16 })
  subjectType!: string;

  @Property({ type: 'uuid' })
  subjectId!: string;

  /** `'google'` | `'microsoft'`. */
  @Property({ type: 'string', length: 16 })
  provider!: string;

  /** The IdP `sub` claim — stable provider-side identifier. */
  @Property({ type: 'string', length: 255 })
  providerSubject!: string;

  /** Verified email at link time (used for resolution). */
  @Property({ type: 'string', length: 320 })
  @Index()
  email!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  linkedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  lastUsedAt?: Date | null;
}
