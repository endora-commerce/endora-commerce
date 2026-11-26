import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'node:crypto';

/**
 * An operator-designed layout for one document type (`specs/152-compare-pdf-template/`,
 * `data-model.md` §1).
 *
 * Platform-global configuration (Principle XI): a template is shop
 * configuration shared by every organisation, and tenant data enters a document
 * only as the host-built data of one render. `salesChannelId` is the scope —
 * `null` for all channels — and never changes after creation. `content` is
 * `{ schemaVersion: 1, languages: { <lang>: <Puck tree> } }`, stored as entered.
 *
 * Written only by the module's Commands (`commands/document-template-commands.ts`).
 */
@GlobalEntity()
@Entity({ tableName: 'document_templates' })
@Index({ name: 'document_templates_type_scope_idx', properties: ['documentType', 'salesChannelId'] })
export class DocumentTemplate {
  [OptionalProps]?: 'id' | 'salesChannelId' | 'isDefault' | 'version' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 120 })
  documentType!: string;

  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'uuid', nullable: true })
  salesChannelId: string | null = null;

  @Property({ type: 'json' })
  content!: { schemaVersion: 1; languages: Record<string, unknown> };

  @Property({ type: 'boolean' })
  isDefault: boolean = false;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
