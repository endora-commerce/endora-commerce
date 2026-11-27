import { Migration } from '@mikro-orm/migrations';

/**
 * `example_erp_keys` — its side table on `organizations`
 * (`specs/190-overlay-full-modules/` US8; `specs/187-side-table-extensions/`).
 *
 * The shape 187's physical rules verify after every `migrate` and at boot
 * (`contracts/verification-rules.md` §4): the primary key is exactly one column,
 * `organization_id`, and that column is a foreign key to the host's primary key
 * with `on delete cascade` — an Organization's key goes with it, and nothing
 * else does. `erp_key` is unique across the shop.
 *
 * Read from this directory at runtime under `DEPLOYMENT=example` and applied
 * under the foreign-schema guard with no exemption: the foreign key references
 * `organizations`, which the manifest declares, so it is no foreign write.
 */
export class Migration20261127T080901ExampleErpKeysCreateOrganizationKeys extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "example_erp_keys_organization_keys" (
        "organization_id" uuid not null,
        "erp_key" text not null,
        "created_at" timestamptz not null default now(),
        constraint "example_erp_keys_organization_keys_pkey" primary key ("organization_id"),
        constraint "example_erp_keys_organization_keys_erp_key_unique" unique ("erp_key"),
        constraint "example_erp_keys_organization_keys_organization_fk"
          foreign key ("organization_id") references "organizations" ("id") on delete cascade
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "example_erp_keys_organization_keys";`);
  }
}
