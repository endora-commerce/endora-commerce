import { Migration } from '@mikro-orm/migrations';

/**
 * A price book's own record of the values its Commands changed (issue #470,
 * D-288; owner ruling O-3, 2026-11-10): who changed price X from A to B.
 *
 * The platform audit log is not tenant-scoped, so a `price_list.*` audit entry
 * is to name what a write changed and point at its row here (`valueChangeId`),
 * not carry the prices, the book's name, its priority or its audience. This
 * migration only creates the store; nothing writes it yet.
 *
 * - `price_list_value_changes` — one row per Command that changed a value:
 *   the action, the actor, the time, the changed header values (`name`,
 *   `priority`, `audience.memberIds`, a duplicate's multiplier) and how many
 *   lines it holds. Indexed for a book's history newest first.
 * - `price_list_row_value_changes` — one line per price row the Command
 *   added, changed or removed: the row's selection and quantity window and both
 *   sides of its price, in the row's own column types. `price_list_id` and `at`
 *   are copied from the change so that one index answers one product's history
 *   in a book. An `added` line has no before side, a `removed` line no after
 *   side, and a `changed` line both.
 *
 * Both tables go with their book (`on delete cascade`; owner ruling,
 * 2026-11-10), and the lines with their change. The selection ids reference no
 * catalogue table: the history outlives a catalogue delete. Every table named
 * here is this module's own.
 *
 * Audit entries written before this migration are not touched (owner ruling
 * O-4): they keep the values they were written with.
 */
export class Migration20261110T073922PriceListsValueChanges extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "price_list_value_changes" (
      "id" uuid not null default gen_random_uuid(),
      "price_list_id" uuid not null,
      "action" varchar(48) not null,
      "actor_kind" varchar(16) not null,
      "actor_admin_user_id" uuid null,
      "at" timestamptz not null default now(),
      "header_before" jsonb null,
      "header_after" jsonb null,
      "line_count" integer not null default 0,
      constraint "price_list_value_changes_pkey" primary key ("id"),
      constraint "price_list_value_changes_price_list_id_foreign"
        foreign key ("price_list_id") references "price_lists" ("id") on delete cascade
    );`);
    this.addSql(`create index if not exists "price_list_value_changes_book_at_idx"
      on "price_list_value_changes" ("price_list_id", "at" desc, "id" desc);`);

    this.addSql(`create table if not exists "price_list_row_value_changes" (
      "change_id" uuid not null,
      "seq" integer not null,
      "price_list_id" uuid not null,
      "at" timestamptz not null,
      "kind" varchar(8) not null,
      "variant_id" uuid null,
      "product_id" uuid null,
      "category_id" uuid null,
      "attribute_key" varchar(64) null,
      "attribute_value" varchar(255) null,
      "min_quantity" integer not null,
      "max_quantity" integer null,
      "before_price_type" varchar(16) null,
      "before_amount" numeric(14,4) null,
      "before_percent" numeric(7,2) null,
      "after_price_type" varchar(16) null,
      "after_amount" numeric(14,4) null,
      "after_percent" numeric(7,2) null,
      constraint "price_list_row_value_changes_pkey" primary key ("change_id", "seq"),
      constraint "price_list_row_value_changes_change_id_foreign"
        foreign key ("change_id") references "price_list_value_changes" ("id") on delete cascade,
      constraint "price_list_row_value_changes_price_list_id_foreign"
        foreign key ("price_list_id") references "price_lists" ("id") on delete cascade,
      constraint "price_list_row_value_changes_kind_check"
        check ("kind" in ('added', 'changed', 'removed')),
      constraint "price_list_row_value_changes_price_type_check"
        check (("before_price_type" is null or "before_price_type" in ('fixed', 'percent', 'amount'))
           and ("after_price_type" is null or "after_price_type" in ('fixed', 'percent', 'amount'))),
      constraint "price_list_row_value_changes_sides_check" check (
        ("kind" = 'added'
          and "before_price_type" is null and "before_amount" is null and "before_percent" is null
          and "after_price_type" is not null)
        or ("kind" = 'removed'
          and "after_price_type" is null and "after_amount" is null and "after_percent" is null
          and "before_price_type" is not null)
        or ("kind" = 'changed' and "before_price_type" is not null and "after_price_type" is not null)
      )
    );`);
    // The prefix (price_list_id) serves the book's cascade; product_id IS NULL
    // selections (category, attribute, all) share one prefix value.
    this.addSql(`create index if not exists "price_list_row_value_changes_book_product_at_idx"
      on "price_list_row_value_changes" ("price_list_id", "product_id", "at" desc);`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "price_list_row_value_changes";`);
    this.addSql(`drop table if exists "price_list_value_changes";`);
  }
}
