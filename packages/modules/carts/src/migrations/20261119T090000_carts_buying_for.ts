import { Migration } from '@mikro-orm/migrations';

/**
 * `specs/182-related-payers/` T060 (FR-110, data-model) — *Buying for*: the payer whose
 * commercial terms price this cart, owned by `carts` as cart data.
 *
 * - `buying_for_organization_id` — the payer Y, or `null` for the buyer's own terms;
 * - `buying_for_terms` — the terms the link carried when chosen (`payer` today); kept so a later
 *   read can tell a cart whose link changed from one that never named a payer.
 *
 * Both cleared on completion. No foreign key to `organizations`: the policy port re-checks the
 * link on every read and resets a cart whose payer is no longer usable (FR-116).
 */
export class Migration20261119T090000CartsBuyingFor extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "carts"
        add column "buying_for_organization_id" uuid null,
        add column "buying_for_terms" varchar(8) null,
        add constraint "carts_buying_for_terms_check" check (
          ("buying_for_organization_id" is null and "buying_for_terms" is null)
          or ("buying_for_organization_id" is not null and "buying_for_terms" in ('buyer', 'payer'))
        );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "carts"
        drop constraint if exists "carts_buying_for_terms_check",
        drop column if exists "buying_for_terms",
        drop column if exists "buying_for_organization_id";
    `);
  }
}
