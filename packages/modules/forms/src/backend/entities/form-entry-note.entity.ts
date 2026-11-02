import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * An employee's note on an entry (`specs/170-forms-module/data-model.md` §5). Append-only, plain
 * text, and never in any e-mail, event, export or public response (FR-049).
 *
 * A note has no tenant of its own: it is reachable only through its entry, whose customer scope it
 * inherits (the CRM comment precedent).
 */
@TransitivelyScoped('FormEntry', 'entryId')
@Entity({ tableName: 'form_entry_notes' })
export class FormEntryNote {
  [OptionalProps]?: 'id' | 'authorAdminUserId' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  entryId!: string;

  /** 1…5 000 characters. */
  @Property({ type: 'text' })
  body!: string;

  /** From the ambient actor. */
  @Property({ type: 'uuid', nullable: true })
  authorAdminUserId: string | null = null;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();
}
