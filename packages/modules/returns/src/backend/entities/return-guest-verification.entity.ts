import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * ReturnGuestVerification — one e-mail verification link a visitor without an
 * account requested, which becomes their **guest session** once redeemed
 * (`specs/181-guest-complaints/` data-model §4, research R-3, R-4).
 *
 * **`@GlobalEntity`** (research R-1): it belongs to no customer and no
 * organization. It is addressed only by its sealed id (the link) or by the hash
 * of its session token, and has no admin read surface.
 *
 * - *requested*: `linkExpiresAt` = created + 60 min (set to now when a newer
 *   request supersedes it);
 * - *session*: `redeemedAt`, `sessionTokenHash` and `sessionExpiresAt` (+24 h) set
 *   once; only the token's SHA-256 is stored;
 * - *ended*: `endedAt` set when the visitor leaves.
 *
 * Rows are deleted 7 days after `createdAt` (FR-026).
 */
@GlobalEntity()
@Entity({ tableName: 'return_guest_verifications' })
export class ReturnGuestVerification {
  [OptionalProps]?: 'id' | 'redeemedAt' | 'sessionTokenHash' | 'sessionExpiresAt' | 'endedAt' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** The request's resolved channel: the session is valid on it only. No FK (kernel table). */
  @Property({ type: 'uuid' })
  salesChannelId!: string;

  /** As typed, trimmed. */
  @Property({ type: 'string', length: 254 })
  email!: string;

  /** SHA-256 hex of the lower-cased address: throttles and supersession (R-3, R-8). */
  @Property({ type: 'string', length: 64, columnType: 'char(64)' })
  emailHash!: string;

  /** The request language, for the storefront's copy. */
  @Property({ type: 'string', length: 16 })
  language!: string;

  @Property({ type: 'datetime' })
  linkExpiresAt!: Date;

  @Property({ type: 'datetime', nullable: true })
  redeemedAt?: Date | null;

  @Property({ type: 'string', length: 64, columnType: 'char(64)', nullable: true })
  sessionTokenHash?: string | null;

  @Property({ type: 'datetime', nullable: true })
  sessionExpiresAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  endedAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  @Index()
  createdAt: Date = new Date();
}
