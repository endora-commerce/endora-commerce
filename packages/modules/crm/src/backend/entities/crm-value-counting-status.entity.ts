import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

export type CrmDocumentKind = 'order' | 'quote_request';

/**
 * A document status that counts toward a computed Opportunity value: an Order
 * status code, or one of the fixed Quote Request statuses. A set, not a
 * threshold — statuses form a graph. With an empty set a computed value is 0.
 */
@GlobalEntity()
@Entity({ tableName: 'crm_value_counting_statuses' })
@Unique({ properties: ['documentKind', 'statusCode'] })
export class CrmValueCountingStatus {
  [OptionalProps]?: 'id' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 16 })
  documentKind!: CrmDocumentKind;

  @Property({ type: 'string', length: 64 })
  statusCode!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
