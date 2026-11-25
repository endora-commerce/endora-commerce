import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * One row, one instant: when unread Project messages started being counted on
 * this installation. An administrator with no `ProjectMessageRead` for a
 * Project has unread only the messages written after it. Written once, by the
 * migration; nothing changes it.
 *
 * `@GlobalEntity`, as CRM's `CrmMessageReadBaseline` is: the row belongs to the
 * installation, names no Project and carries nothing tenant-scoped.
 */
@GlobalEntity()
@Entity({ tableName: 'project_message_read_baselines' })
export class ProjectMessageReadBaseline {
  @PrimaryKey({ type: 'smallint' })
  id: number = 1;

  @Property({ type: 'datetime' })
  unreadSince!: Date;
}
