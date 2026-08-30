import { Migration } from '@mikro-orm/migrations';

/**
 * D-187 — `comparisons` gains its organisation, and a row that names a customer
 * account carries one.
 *
 * Feature 087 Group B, class 1 of 4. `Comparison` is `@CustomerScoped`, and
 * until this migration the `allowed-set` arm of `customerFilterCond` had no
 * column to grant on: a sales representative assigned to the buyer's own
 * organisation was shown **none** of their comparisons and told so, through the
 * `ORGANIZATION_ATTRIBUTION_PENDING` notice the refusing arm records. The
 * column is what turns that into an answer.
 *
 * ## The column and the read arrive together, on purpose
 *
 * `customerOrganizationColumn` asks the ORM's own metadata whether the filtered
 * entity carries `organizationId`, **per query**, so the entity property in
 * this same merge request is what switches the grant on — there is no third
 * artefact, no flag and no staging. At the same instant the notice retires
 * itself: it is keyed on the column's *absence*.
 *
 * That pairing is why this migration is not "column and backfill". From the
 * moment the grant is live, a row inserted without an organisation is invisible
 * to the representative who serves that organisation, on a screen that has just
 * stopped explaining itself — and MikroORM applies no filter to `INSERT`
 * (`r1-spike.md` §4, measured), so the filter cannot refuse it. The `CHECK`
 * below is the only refusal an `INSERT` has.
 *
 * ## An implication, not an equivalence
 *
 * `customer_account_id is null or organization_id is not null` is FR-010 and
 * FR-011 together and nothing wider: an **owned** row has an organisation, an
 * **ownerless** row need not. Half of this table is ownerless by construction —
 * `comparisons_owner_xor_chk` makes every row that is not owned an anonymous
 * one — and who an anonymous comparison belongs to is R-6's open question. The
 * equivalence would answer it in the schema, which D-187 declines to do.
 *
 * ## No foreign key
 *
 * Matching `Cart`, which carries none. D-187 withdraws `r1-spike.md` §8's
 * `on delete set null` recommendation as contradicting FR-011: it produces a
 * row that names an account and no organisation, which is precisely the state
 * this migration makes unreachable, and under the constraint below it would
 * abort an unrelated organisation delete with a message about a table the
 * operator was not touching. If one is ever taken here it must be `restrict`,
 * and it is not this migration's decision.
 *
 * ## Derive, then count, then refuse — never delete
 *
 * The derivation is the owning account's own organisation, and on **this**
 * table it is total by proof rather than by hope.
 * `comparisons_customer_account_fk` is `on delete cascade`, so a row naming an
 * account that is gone cannot exist; `comparisons_owner_xor_chk` makes every
 * other row anonymous; and D-178 made `customer_accounts.organization_id`
 * `NOT NULL`. *Derivable ⟺ has an account* is a theorem here, and the refusal
 * branch is dead code the day it is written.
 *
 * It is written anyway, and that is the point of writing it: a proof that stops
 * being true stops **silently**. Drop the foreign key, relax the XOR, or
 * re-open D-178, and the count below is the only thing that would notice. It
 * raises with the count and up to twenty ids and deletes nothing (D-184), in
 * the shape `20260825T141659_customer_accounts_organization_required.ts`
 * established and `20260830T112911_carts_organization_attribution_check.ts`
 * repeated.
 *
 * ## Nothing to declare in the manifest
 *
 * `comparisons` already declares `organizations`, whose own
 * `20260424T205317_organizations_init.ts` creates `customer_accounts` — far
 * below `BASELINE_THROUGH`, so the table this reads exists whatever this
 * module's position in the dependency order. No foreign key is added, so
 * `fk-dependency-drift` has nothing to say either, and a migration naming
 * another module's table is outside `check:module-boundary`'s population by
 * that check's own rule.
 *
 * The standing guard is
 * `backend/test/integration/tenancy/customer-scoped-organization-completeness.test.ts`,
 * which derives its population from the ORM's metadata rather than from a list
 * — so this class is covered by gaining the column, with no edit to that file.
 */
export class Migration20260830T163143ComparisonsOrganizationAttribution extends Migration {
  override async up(): Promise<void> {
    // 1. The column. Nullable, because an anonymous comparison legitimately has
    //    none (FR-011) and this table is half anonymous by construction.
    this.addSql(`alter table "comparisons" add column "organization_id" uuid null;`);

    // 2. Derive the organisation from the account that owns the comparison.
    //    Total on this table: the foreign key cascades, so an account named
    //    here exists, and its own organisation is NOT NULL since D-178.
    this.addSql(`
      update "comparisons" c
      set "organization_id" = ca."organization_id"
      from "customer_accounts" ca
      where ca."id" = c."customer_account_id"
        and c."organization_id" is null;
    `);

    // 3. Count what is left and refuse. Provably empty today — see the block
    //    comment. It runs because the proof rests on three facts none of which
    //    this migration owns, and a proof that stops being true stops without
    //    saying so.
    this.addSql(`
      do $$
      declare
        remaining bigint;
        sample text;
      begin
        select count(*) into remaining
          from "comparisons"
         where "customer_account_id" is not null
           and "organization_id" is null;
        if remaining > 0 then
          select string_agg(id::text, ', ') into sample from (
            select "id" from "comparisons"
             where "customer_account_id" is not null
               and "organization_id" is null
             order by "id" limit 20
          ) s;
          raise exception
            'D-187: % comparisons row(s) still name a customer account with organization_id IS NULL after derivation. First ids: %. Every customer account has an organization (D-178) and this table cascades on account delete, so these rows contradict the schema. Do not delete them - find out how they got here.',
            remaining, sample;
        end if;
      end $$;
    `);

    // 4. The constraint.
    this.addSql(`
      alter table "comparisons"
        add constraint "comparisons_organization_attribution_chk"
        check ("customer_account_id" is null or "organization_id" is not null);
    `);

    // 5. The index the entity property declares. Partial, like the two owner
    //    indexes the init migration writes: the column is null on every
    //    anonymous row, and the reader is an organisation-scoped list.
    this.addSql(`
      create index "idx_comparisons_organization"
        on "comparisons" ("organization_id")
        where "organization_id" is not null;
    `);
  }

  override async down(): Promise<void> {
    // The constraint, the index and the column. The organisations step 2
    // derived go with the column they were written into — there is nothing to
    // preserve, because each of them was already implied by the account its row
    // names.
    this.addSql(
      `alter table "comparisons" drop constraint if exists "comparisons_organization_attribution_chk";`,
    );
    this.addSql(`drop index if exists "idx_comparisons_organization";`);
    this.addSql(`alter table "comparisons" drop column if exists "organization_id";`);
  }
}
