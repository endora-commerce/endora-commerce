import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * WYSIWYG (Puck) invoice PDF template (feature 047, research R2). One global
 * generic default (`salesChannelId = null`, `isSystem = true`); optional
 * per-channel overrides. `content` is a Puck envelope
 * `{ schema_version, languages: { <lang>: <PuckTree> } }`.
 */
@GlobalEntity()
@Entity({ tableName: 'invoice_templates' })
export class InvoiceTemplate {
  [OptionalProps]?:
    | 'id'
    | 'salesChannelId'
    | 'active'
    | 'isSystem'
    | 'version'
    | 'languages'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 180 })
  @Index()
  code!: string;

  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  salesChannelId?: string | null;

  @Property({ type: 'json' })
  content: Record<string, unknown> = { schema_version: 1, languages: {} };

  @Property({ type: 'json' })
  languages: string[] = [];

  @Property({ type: 'boolean' })
  active: boolean = true;

  @Property({ type: 'boolean' })
  isSystem: boolean = false;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
