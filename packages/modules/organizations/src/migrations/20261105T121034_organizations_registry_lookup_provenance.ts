import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 173 — where a VAT validation row came from, and what a registration
 * row records about the registry lookup it carried
 * (`specs/173-registration-registry-lookup/` data-model §1).
 *
 * - `origin` — `'admin'` for an administrator's "Validate now" (every existing
 *   row, through the default), `'registration'` for the snapshot a
 *   self-registration persisted.
 * - `registry_details` — REGON, VAT and activity status, the registry attempts,
 *   the Polish-sources mode, the fetch time; registration rows only.
 * - `submitted_values` — the company values the registrant submitted, for the
 *   moderator's divergence view; no personal data of the user.
 *
 * - `provider` admits `gus_pl` — the registration row's provider when GUS
 *   supplied the data. The column is `varchar(32)`, but the consolidation
 *   migration pinned its values with `organization_tax_id_validations_provider_check`,
 *   so the check is widened (data-model §1 said "no DDL"; corrected 2026-11-05).
 *
 * Additive: nothing is backfilled beyond the default. No index: the table is
 * read by `organization_id`, newest first, at most 100 rows. Every table touched
 * is this module's own. Repeatable: `if not exists` / `if exists` throughout.
 *
 * `down()` removes the registration rows before restoring the narrower check:
 * they exist only because of this feature, and without `origin` they would be
 * indistinguishable from an administrator's.
 *
 * Registration is a regeneration: `pnpm --filter backend run composer:generate`.
 */
export class Migration20261105T121034OrganizationsRegistryLookupProvenance extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "organization_tax_id_validations"
        add column if not exists "origin" varchar(16) not null default 'admin',
        add column if not exists "registry_details" jsonb null,
        add column if not exists "submitted_values" jsonb null;
    `);
    this.addSql(
      `alter table "organization_tax_id_validations" drop constraint if exists "organization_tax_id_validations_origin_check";`,
    );
    this.addSql(`
      alter table "organization_tax_id_validations"
        add constraint "organization_tax_id_validations_origin_check"
        check ("origin" in ('admin', 'registration'));
    `);
    this.addSql(
      `alter table "organization_tax_id_validations" drop constraint if exists "organization_tax_id_validations_provider_check";`,
    );
    this.addSql(`
      alter table "organization_tax_id_validations"
        add constraint "organization_tax_id_validations_provider_check"
        check ("provider" in ('vies', 'mf_pl', 'format_only', 'gus_pl'));
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`delete from "organization_tax_id_validations" where "origin" = 'registration';`);
    this.addSql(
      `alter table "organization_tax_id_validations" drop constraint if exists "organization_tax_id_validations_provider_check";`,
    );
    this.addSql(`
      alter table "organization_tax_id_validations"
        add constraint "organization_tax_id_validations_provider_check"
        check ("provider" in ('vies', 'mf_pl', 'format_only'));
    `);
    this.addSql(
      `alter table "organization_tax_id_validations" drop constraint if exists "organization_tax_id_validations_origin_check";`,
    );
    this.addSql(`
      alter table "organization_tax_id_validations"
        drop column if exists "submitted_values",
        drop column if exists "registry_details",
        drop column if exists "origin";
    `);
  }
}
