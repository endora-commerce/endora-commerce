import { Migration } from '@mikro-orm/migrations';

/**
 * Default shopping list.
 *
 * Adds `shopping_lists.is_default`: at most one list per (organization,
 * customer) is the customer's default — the target of the storefront
 * "add to shopping list" affordances. Existing customers with at least one
 * list have their earliest-created list promoted to default by the backfill;
 * customers with no list get a "Default" list lazily on first access
 * (ShoppingListService.ensureDefault).
 */
export class Migration074ShoppingListsDefault extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "shopping_lists" add column "is_default" boolean not null default false;`,
    );
    // Promote the earliest-created list per (organization, customer) to default.
    this.addSql(`
      update "shopping_lists" s set "is_default" = true
      where s."id" = (
        select s2."id" from "shopping_lists" s2
        where s2."organization_id" = s."organization_id"
          and s2."customer_account_id" = s."customer_account_id"
        order by s2."created_at" asc, s2."id" asc
        limit 1
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "shopping_lists" drop column "is_default";`);
  }
}
