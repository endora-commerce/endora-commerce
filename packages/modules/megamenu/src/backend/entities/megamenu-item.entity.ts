import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type {
  MegamenuAlignment,
  MegamenuAudience,
  MegamenuItemKind,
  MegamenuPresentation,
} from '@endora-commerce/contracts';

export type { MegamenuItemKind };

/**
 * MegamenuItem — adjacency-list tree node. The `target` property is
 * typed `Record<string, unknown>` at the entity layer; the discriminated
 * union enforced at the Zod boundary lives in
 * `packages/contracts/src/megamenu.ts`.
 *
 * `parent_id` is a self-FK; `position` is the 0..N-1 sort key per
 * `(megamenu_id, parent_id)`. A GIN index on `target` (jsonb_path_ops)
 * powers the cross-module reference scans documented in
 * `contracts/megamenu-reference-scan.contract.md`.
 */
@GlobalEntity()
@Entity({ tableName: 'megamenu_items' })
@Index({ name: 'idx_megamenu_items_tree', properties: ['megamenuId', 'parentId', 'position'] })
export class MegamenuItem {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'parentId'
    | 'position'
    | 'labels'
    | 'descriptions'
    | 'target'
    | 'presentation'
    | 'alignment'
    | 'audience'
    | 'clickNavigates';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'megamenu_id' })
  megamenuId!: string;

  @Property({ type: 'uuid', fieldName: 'parent_id', nullable: true })
  parentId?: string | null;

  @Property({ type: 'integer' })
  position: number = 0;

  @Property({ type: 'string', length: 32 })
  kind!: MegamenuItemKind;

  @Property({ type: 'json' })
  labels: Record<string, string> = {};

  @Property({ type: 'json', nullable: true })
  descriptions?: Record<string, string> | null;

  @Property({ type: 'json' })
  target: Record<string, unknown> = {};

  /** Feature 168 — how a tab opens. Set exactly on top-level rows (a check constraint holds it). */
  @Property({ type: 'string', length: 16, nullable: true })
  presentation?: MegamenuPresentation | null;

  /** Feature 168 — which end of the bar a tab sits at. Set exactly on top-level rows. */
  @Property({ type: 'string', length: 8, nullable: true })
  alignment?: MegamenuAlignment | null;

  /** Feature 168 — a tab whose click follows its own link; the panel opens on hover or its toggle. */
  @Property({ type: 'boolean', fieldName: 'click_navigates' })
  clickNavigates: boolean = false;

  /** Feature 168 — who may see the item and its subtree. */
  @Property({ type: 'json' })
  audience: MegamenuAudience = { kind: 'everyone' };

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
