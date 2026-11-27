import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

export type CrmOpportunityCommentKind = 'note' | 'message';

/**
 * A note or an internal message on an Opportunity. Both are internal: there is
 * no customer-visible flag at all. A note is editable and soft-deletable by its
 * author (`deletedAt`, so the history stays truthful); a message is immutable.
 * `body` is plain text carrying reference tokens.
 */
@TransitivelyScoped('CrmOpportunity', 'opportunityId')
@Entity({ tableName: 'crm_opportunity_comments' })
@Index({ properties: ['opportunityId', 'kind', 'createdAt'] })
export class CrmOpportunityComment {
  [OptionalProps]?: 'id' | 'editedAt' | 'deletedAt' | 'createdAt' | 'customFieldValues';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  opportunityId!: string;

  @Property({ type: 'string', length: 8 })
  kind!: CrmOpportunityCommentKind;

  @Property({ type: 'uuid' })
  authorAdminUserId!: string;

  @Property({ type: 'text' })
  body!: string;

  /**
   * A note's operator-defined field values, keyed by `opportunity_note`
   * definition key (issue #2005). Validated by `custom_fields` and written by
   * the note's own Commands; `{}` on a message, which is no host.
   */
  @Property({ type: 'json' })
  customFieldValues: Record<string, unknown> = {};

  /** Notes only. */
  @Property({ type: 'datetime', nullable: true })
  editedAt?: Date | null;

  /** Notes only. */
  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
