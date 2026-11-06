import { Migration } from '@mikro-orm/migrations';

/**
 * `specs/173-b2c-address-book-merge/` release 1 (plan R-5) — the provenance
 * columns the personal-address-book retirement job writes.
 *
 * - `merged_into_address_id`: the Organization address a moved row became.
 *   Provenance only and never joined, so no foreign key — which also keeps
 *   this migration inside this module's own table (`check:module-boundary`).
 * - `merged_at`: when the job moved it.
 * - `merge_refusal`: the owner's error code when `addresses` refused the move.
 *   A refused row stays live, for the operator to see on the admin card.
 * - a partial index over the rows the job still has to process.
 *
 * Release 2 drops the whole table, once no live row is left.
 */
export class Migration20261105T180317CustomersAddressBookRetirement extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "customer_addresses"
        add column "merged_into_address_id" uuid null,
        add column "merged_at" timestamptz null,
        add column "merge_refusal" varchar(64) null;
    `);
    this.addSql(
      `create index "customer_addresses_retirement_pending_index" on "customer_addresses" ("customer_account_id") where "deleted_at" is null and "merge_refusal" is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "customer_addresses_retirement_pending_index";');
    this.addSql(`
      alter table "customer_addresses"
        drop column if exists "merged_into_address_id",
        drop column if exists "merged_at",
        drop column if exists "merge_refusal";
    `);
  }
}
