import { Migration } from '@mikro-orm/migrations';

/**
 * Exactly one system price list, enforced by the database (issue #50).
 *
 * `is_system` marks the seeded `Default` row — the terminal fallback of the
 * resolution chain (feature 011, FR-026/FR-027). Since the issue-#132 ruling
 * made catalogue listings ask `price_lists` for the price they show, that row
 * is load-bearing: the chain is *default price list → prices attached directly
 * to the product → no price displayed*. Nothing enforced the singleton, so a
 * second `is_system` row was merely a convention away, and a test fixture
 * created one.
 *
 * `price_lists` is `@RuleScoped()` — it carries **no** tenant column, because
 * organisation targeting lives inside `application_rule` rather than beside it.
 * So the singleton is platform-wide and the index has no tenant key to add:
 * one `is_system` row in the table, full stop. A per-organisation index here
 * would be a column that does not exist.
 *
 * The demotion below runs first so the index can be created on a database that
 * already drifted. It keeps the canonically seeded `Default` row when present
 * and otherwise the oldest system row, and clears the flag on the rest. That
 * drops no list, no assignment and no bracket — only a marker that was never
 * valid on more than one row.
 */

const DEFAULT_PRICE_LIST_ID = '00000000-0000-4000-8000-00000000d51b';

/** The partial unique index this migration installs. */
export const SYSTEM_PRICE_LIST_INDEX = 'price_lists_is_system_unique';

/**
 * `up()` as data, so the demotion can be exercised against a database that has
 * actually drifted — which a freshly migrated test database never has.
 * `test/integration/price_lists/system-price-list-singleton.test.ts` replays
 * these statements after re-creating the drift.
 */
export const SINGLE_SYSTEM_PRICE_LIST_SQL: readonly string[] = [
  `update "price_lists"
      set "is_system" = false
    where "is_system" = true
      and "id" <> (
        select "id"
          from "price_lists"
         where "is_system" = true
         order by ("id" = '${DEFAULT_PRICE_LIST_ID}') desc, "created_at" asc, "id" asc
         limit 1
      );`,
  `create unique index if not exists "${SYSTEM_PRICE_LIST_INDEX}"
     on "price_lists" ("is_system")
     where "is_system" = true;`,
];

export class Migration20260817T055457PriceListsSingleSystemPriceList extends Migration {
  override async up(): Promise<void> {
    for (const statement of SINGLE_SYSTEM_PRICE_LIST_SQL) this.addSql(statement);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "${SYSTEM_PRICE_LIST_INDEX}";`);
  }
}
