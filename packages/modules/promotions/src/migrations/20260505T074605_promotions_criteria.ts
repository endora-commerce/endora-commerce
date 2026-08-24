import { Migration } from '@mikro-orm/migrations';

/**
 * Promotions feature 012 / US8 — add the JSONB `criteria` column to
 * `promotions`.
 *
 * The column carries a discriminated-union array of line-level criteria
 * (today only the `attribute` variant is exercised). It is ANDed with
 * the existing flat `category_id` / `product_id` scope: a cart line is
 * included in a promotion's `lineBase` only if it satisfies both the
 * legacy scope and every criterion.
 *
 * Default `'[]'::jsonb` so every existing promotion keeps its current
 * behaviour without operator action.
 */
export class Migration20260505T074605PromotionsCriteria extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "promotions" add column "criteria" jsonb not null default '[]'::jsonb;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "promotions" drop column "criteria";`);
  }
}
