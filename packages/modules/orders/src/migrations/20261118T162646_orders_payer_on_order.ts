import { Migration } from '@mikro-orm/migrations';

/**
 * `specs/182-related-payers/` (data-model §3, research R-2) — the payer on the order, owned
 * by `orders` as order data, so it reads the same with `related_payers` switched off
 * (FR-004, FR-051). All four nullable: an order without a payer is every order before this.
 *
 * - `payer_organization_id` — the Organization billed (indexed: the payer's paid-order list,
 *   the admin filter, the invoice ledger key);
 * - `payer_link_id` — provenance, the link that vouched for it at placement;
 * - `payer_terms` — `buyer` | `payer`, whose commercial terms priced it (FR-117);
 * - `payer_snapshot` — `{ organizationId, name, taxId, vatStatus, billingAddress }` frozen at
 *   placement (FR-067). A value: never recorded in audit state.
 *
 * No foreign key to `organizations`: an order outlives its payer's record as history.
 */
export class Migration20261118T162646OrdersPayerOnOrder extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "orders"
        add column "payer_organization_id" uuid null,
        add column "payer_link_id" uuid null,
        add column "payer_terms" varchar(8) null,
        add column "payer_snapshot" jsonb null,
        add constraint "orders_payer_terms_check" check ("payer_terms" is null or "payer_terms" in ('buyer', 'payer'));
    `);
    this.addSql(
      `create index "orders_payer_organization_id_index" on "orders" ("payer_organization_id") where "payer_organization_id" is not null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "orders_payer_organization_id_index";`);
    this.addSql(`
      alter table "orders"
        drop constraint if exists "orders_payer_terms_check",
        drop column if exists "payer_snapshot",
        drop column if exists "payer_terms",
        drop column if exists "payer_link_id",
        drop column if exists "payer_organization_id";
    `);
  }
}
