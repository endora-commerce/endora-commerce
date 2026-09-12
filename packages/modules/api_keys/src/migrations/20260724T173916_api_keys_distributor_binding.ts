import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 062 — Distributor API key binding (data-model.md §1), and since
 * `specs/120-migration-closure-bridge-ownership/` Phase 3 the **creation** of
 * `api_keys` itself.
 *
 * The table was created by `webhooks`' frozen
 * `Migration20260425T091359WebhooksUs7Init`: the two modules were one surface
 * until the US7 split, and the creation stayed behind while the entity, the
 * service and every other statement came here. An instance installing
 * `api_keys` without `webhooks` therefore had no migration that builds the
 * table, and this very migration named a table outside its own closure (D-226).
 *
 * **It moved from one frozen body into another, and that is the whole of
 * FR-014.** D-226's prescribed repair — subtract the statement and re-add it
 * above `BASELINE_THROUGH` — is right for a *reference*, which can only move
 * strictly later in the computed order. It is wrong for a *creation*: an
 * above-watermark migration runs after the entire frozen prefix, and two frozen
 * migrations reference `api_keys` — this one's own `alter table` below, and
 * `Migration20260724T193611OrdersOrderPlacementIntents`' foreign key. The
 * creation would have landed after both and broken a fresh database. This
 * migration's historical position precedes both, so it is where the creation
 * goes. Both class names are unchanged and `BASELINE_MIGRATIONS` is untouched:
 * `mikro_orm_migrations` persists the class name and no checksum, so neither
 * edited body is re-offered to a database that has applied it.
 *
 * **`if not exists`, and it is load-bearing rather than defensive.** A database
 * that applied the April migration and has not yet reached this one — anything
 * behind by a release — already has `api_keys` while this migration is pending.
 * A verbatim `create table` would fail there. With the guard it is a no-op on
 * that database and the creation on a fresh one.
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
export class Migration20260724T173916ApiKeysDistributorBinding extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "api_keys" (
        "id" uuid not null,
        "name" varchar(160) not null,
        "key_hash" varchar(128) not null,
        "last_four" varchar(8) not null,
        "scopes" jsonb not null default '[]'::jsonb,
        "status" varchar(16) not null default 'active',
        "last_used_at" timestamptz null,
        "revoked_at" timestamptz null,
        "created_by_admin_user_id" uuid null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "api_keys_pkey" primary key ("id"),
        constraint "api_keys_key_hash_unique" unique ("key_hash")
      );
    `);
    this.addSql(
      'create index if not exists "api_keys_key_hash_index" on "api_keys" ("key_hash");',
    );

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
    this.addSql('drop table if exists "api_keys" cascade;');
  }
}
