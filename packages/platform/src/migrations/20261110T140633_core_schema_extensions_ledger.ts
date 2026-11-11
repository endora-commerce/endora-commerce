import { Migration } from '@mikro-orm/migrations';

/**
 * The `schema_extensions` ledger (`specs/178-extensible-columns/` FR-022,
 * `data-model.md` §1).
 *
 * One row per physical element a declared extension added to a host table — a
 * column or an index — written by the generated migration step of the declaring
 * module and read by the verifier at migrate and at boot. It is the record that
 * makes an extension column a known fact rather than an unexplained column:
 * which module declared it, with which normalised spec, and whether it is
 * `applied`, `orphaned` (the declaration is gone, the column and its data are
 * kept, OD-29) or `dropped` (the audited drop command removed it, or the host
 * table was dropped).
 *
 * Platform-owned and global: an extension is a fact about the instance's
 * schema, not about any one tenant. The partial unique index lets a `dropped`
 * row stay as history while a later declaration of the same name gets a new
 * row. No foreign key to the host tables — the ledger outlives a host's hard
 * uninstall, which is the case it records as `dropped`.
 *
 * Registration is a regeneration: run
 * `pnpm --filter backend run composer:generate` and commit the result. An
 * unregistered migration does not run, and the round-trip guard fails the
 * build for it.
 *
 * This stamp orders this migration against its own module's migrations and
 * against nothing else. It references no table another module owns.
 */
export class Migration20261110T140633CoreSchemaExtensionsLedger extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "schema_extensions" (
      "id" uuid not null,
      "module_id" text not null,
      "host_table" text not null,
      "kind" text not null,
      "physical_name" text not null,
      "declared_key" text not null,
      "spec" jsonb not null,
      "spec_hash" text not null,
      "status" text not null,
      "platform_version" text not null,
      "package_version" text null,
      "applied_at" timestamptz not null,
      "orphaned_at" timestamptz null,
      "dropped_at" timestamptz null,
      "drop_audit_id" uuid null,
      constraint "schema_extensions_pkey" primary key ("id"),
      constraint "schema_extensions_kind_check" check ("kind" in ('column', 'index')),
      constraint "schema_extensions_status_check" check ("status" in ('applied', 'orphaned', 'dropped'))
    );`);
    this.addSql(
      `create unique index if not exists "schema_extensions_host_table_physical_name_unique" ` +
        `on "schema_extensions" ("host_table", "physical_name") where "status" <> 'dropped';`,
    );
    this.addSql(
      `create index if not exists "schema_extensions_module_id_index" on "schema_extensions" ("module_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "schema_extensions";`);
  }
}
