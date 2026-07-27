import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 062 — Distributor API key binding (data-model.md §1).
 *
 * Adds the distributor binding columns to `api_keys`:
 *  - `organization_id` / `sales_channel_id` / `customer_account_id` — the
 *    all-or-none binding that pins a key to one org, one channel, and one
 *    designated service customer account. `ON DELETE RESTRICT`: revoke keys
 *    before removing the bound rows.
 *  - `expires_at` — optional expiry; NULL = non-expiring. `authenticate()`
 *    refuses past instants.
 *
 * Existing rows keep all four columns NULL ⇒ unbound legacy keys, behavior
 * unchanged (FR-020). The cross-row rule "service account belongs to the bound
 * org" is enforced at creation in `ApiKeyService.create` (research §R4), not
 * as a DB constraint.
 */
export class Migration103ApiKeysDistributorBinding extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "api_keys"
        add column "organization_id" uuid null,
        add column "sales_channel_id" uuid null,
        add column "customer_account_id" uuid null,
        add column "expires_at" timestamptz null;
    `);
    this.addSql(`
      alter table "api_keys"
        add constraint "api_keys_organization_id_foreign"
          foreign key ("organization_id") references "organizations" ("id")
          on update cascade on delete restrict;
    `);
    this.addSql(`
      alter table "api_keys"
        add constraint "api_keys_sales_channel_id_foreign"
          foreign key ("sales_channel_id") references "sales_channels" ("id")
          on update cascade on delete restrict;
    `);
    this.addSql(`
      alter table "api_keys"
        add constraint "api_keys_customer_account_id_foreign"
          foreign key ("customer_account_id") references "customer_accounts" ("id")
          on update cascade on delete restrict;
    `);
    this.addSql(`
      alter table "api_keys"
        add constraint "api_keys_binding_all_or_none" check (
          ("organization_id" is null and "sales_channel_id" is null and "customer_account_id" is null)
          or
          ("organization_id" is not null and "sales_channel_id" is not null and "customer_account_id" is not null)
        );
    `);
    this.addSql(
      `create index "api_keys_organization_id_index" on "api_keys" ("organization_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "api_keys_organization_id_index";`);
    this.addSql(`alter table "api_keys" drop constraint if exists "api_keys_binding_all_or_none";`);
    this.addSql(
      `alter table "api_keys" drop constraint if exists "api_keys_customer_account_id_foreign";`,
    );
    this.addSql(
      `alter table "api_keys" drop constraint if exists "api_keys_sales_channel_id_foreign";`,
    );
    this.addSql(
      `alter table "api_keys" drop constraint if exists "api_keys_organization_id_foreign";`,
    );
    this.addSql(`
      alter table "api_keys"
        drop column "organization_id",
        drop column "sales_channel_id",
        drop column "customer_account_id",
        drop column "expires_at";
    `);
  }
}
