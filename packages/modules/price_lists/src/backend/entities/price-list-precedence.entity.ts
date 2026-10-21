import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import type { CellCode, DepthMode } from '../services/precedence.js';

/**
 * One version of the configurable buyer-cell precedence (feature 160, D-287
 * §5.6, FR-021): the order of the twelve buyer cells, the
 * category-before-attribute toggle and the depth mode. Exactly one version is
 * `active` (a partial unique index); version 1 = **HY** is installed by the
 * expand migration. P1 has no write path (FR-023) — the staged change flow with
 * its impact preview is P3.
 *
 * Platform-wide configuration of this module, `@RuleScoped()` like every table
 * the module owns (data-model preamble): it carries no tenant column and is read
 * by every resolution.
 */
@RuleScoped()
@Entity({ tableName: 'price_list_precedence' })
export class PriceListPrecedence {
  [OptionalProps]?: 'impact' | 'createdBy' | 'createdAt' | 'activatedAt';

  @PrimaryKey({ type: 'integer', autoincrement: false })
  version!: number;

  @Property({ type: 'json' })
  cells!: CellCode[];

  @Property({ type: 'boolean' })
  categoryBeforeAttribute!: boolean;

  @Property({ type: 'string', length: 32 })
  depthMode!: DepthMode;

  @Property({ type: 'string', length: 16 })
  state!: 'staged' | 'active' | 'superseded';

  /** P3's preview report. */
  @Property({ type: 'json', nullable: true })
  impact: Record<string, unknown> | null = null;

  @Property({ type: 'uuid', nullable: true })
  createdBy: string | null = null;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  activatedAt: Date | null = null;
}
