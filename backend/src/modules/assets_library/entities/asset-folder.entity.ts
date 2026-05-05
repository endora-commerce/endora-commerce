import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * AssetFolder — organisational tree node for the Assets Library page.
 * Folders are pure metadata; moving an asset between folders is a metadata
 * update only, never a physical file move (research R11, FR-008).
 */
@Entity({ tableName: 'asset_folders' })
export class AssetFolder {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'parentId' | 'position';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', nullable: true })
  @Index()
  parentId?: string | null;

  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'integer' })
  position: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
