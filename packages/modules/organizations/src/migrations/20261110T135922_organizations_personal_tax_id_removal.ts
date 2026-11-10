import { Migration } from '@mikro-orm/migrations';

/**
 * `specs/177-tax-id-scope/` (data-model §1, §3 M1) — personal organizations stop
 * carrying a synthetic tax ID.
 *
 * Since feature 051 a personal (B2C) organization stored the customer account's
 * id without dashes as its `tax_id`: 32 hex characters, unique, and derived,
 * which satisfied `not null` + unique and made the provisioning re-runnable.
 * Both jobs move:
 *
 * - `personal_account_id` — the account the row was provisioned for, backfilled
 *   by putting the dashes back into the placeholder. Not a foreign key:
 *   `customer_accounts` depends on this module, so a reverse FK would make the
 *   graph cyclic (research R-3). Unique where set; personal rows only.
 * - `tax_id` becomes nullable and every personal row's is cleared. The check
 *   `organizations_tax_id_presence` makes "personal ⇔ no tax ID" a rule
 *   (FR-001). `organizations_tax_id_unique` is kept as it is: NULLs are
 *   distinct, so the personal rows never collide.
 * - `converted_to_company_at` — for the conversion (FR-039); null on every row.
 *
 * A personal row whose tax ID is not the 32-hex placeholder (hand-made data) is
 * cleared all the same and left without a link; how many is raised as a notice.
 *
 * Every table touched is this module's own. Nothing else is rewritten: orders,
 * invoices, quote documents and audit entries keep whatever they hold (FR-007).
 * Repeatable: `if not exists` and guarded blocks throughout.
 *
 * `down()` restores the placeholder from the link — or from the organization's
 * own id for an unlinked personal row — and the old `not null`.
 *
 * Registration is a regeneration: `pnpm --filter backend run composer:generate`.
 */
export class Migration20261110T135922OrganizationsPersonalTaxIdRemoval extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "organizations"
        add column if not exists "personal_account_id" uuid null,
        add column if not exists "converted_to_company_at" timestamptz null;
    `);
    this.addSql(`
      update "organizations"
         set "personal_account_id" = (
           substr("tax_id", 1, 8) || '-' || substr("tax_id", 9, 4) || '-' ||
           substr("tax_id", 13, 4) || '-' || substr("tax_id", 17, 4) || '-' ||
           substr("tax_id", 21, 12)
         )::uuid
       where "is_personal"
         and "personal_account_id" is null
         and "tax_id" ~ '^[0-9a-f]{32}$';
    `);
    this.addSql(`alter table "organizations" alter column "tax_id" drop not null;`);
    this.addSql(
      `update "organizations" set "tax_id" = null where "is_personal" and "tax_id" is not null;`,
    );
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint
           where conrelid = 'organizations'::regclass and conname = 'organizations_tax_id_presence'
        ) then
          alter table "organizations"
            add constraint "organizations_tax_id_presence" check ("is_personal" = ("tax_id" is null));
        end if;
        if not exists (
          select 1 from pg_constraint
           where conrelid = 'organizations'::regclass and conname = 'organizations_personal_account_link'
        ) then
          alter table "organizations"
            add constraint "organizations_personal_account_link"
            check ("personal_account_id" is null or "is_personal");
        end if;
      end
      $$;
    `);
    this.addSql(`
      create unique index if not exists "organizations_personal_account_id_unique"
        on "organizations" ("personal_account_id") where "personal_account_id" is not null;
    `);
    this.addSql(`
      do $$
      declare unlinked integer;
      begin
        select count(*) into unlinked
          from "organizations" where "is_personal" and "personal_account_id" is null;
        if unlinked > 0 then
          raise notice 'organizations: % personal organization(s) left without an account link (their tax ID was not the account placeholder)', unlinked;
        end if;
      end
      $$;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "organizations"
        drop constraint if exists "organizations_tax_id_presence",
        drop constraint if exists "organizations_personal_account_link";
    `);
    this.addSql(`
      update "organizations"
         set "tax_id" = replace(coalesce("personal_account_id", "id")::text, '-', '')
       where "is_personal" and "tax_id" is null;
    `);
    this.addSql(`alter table "organizations" alter column "tax_id" set not null;`);
    this.addSql(`drop index if exists "organizations_personal_account_id_unique";`);
    this.addSql(`
      alter table "organizations"
        drop column if exists "converted_to_company_at",
        drop column if exists "personal_account_id";
    `);
  }
}
