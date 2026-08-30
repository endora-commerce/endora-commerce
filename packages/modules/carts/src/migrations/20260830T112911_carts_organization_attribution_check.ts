import { Migration } from '@mikro-orm/migrations';

/**
 * D-187 — a `carts` row that names a customer account carries an organisation.
 *
 * `Cart` is the one `@CustomerScoped` class that already has the column
 * (feature 087, Group B), and it has had it since before the granting arm of
 * `customerFilterCond` went live. Nothing structural has held the pair
 * together: `customerOrganizationColumn` reads the ORM's metadata per query, so
 * the moment the property existed a sales representative's list was filtered on
 * `organization_id` — and MikroORM applies no filter to `INSERT`
 * (`r1-spike.md` §4, measured), so a row written with an account and no
 * organisation is simply invisible to the representative who serves that
 * organisation, on a screen that has stopped saying anything is missing.
 *
 * **The constraint is the only refusal an `INSERT` has**, which is the same
 * sentence `20260825T141659_customer_accounts_organization_required.ts` opens
 * with, and the same reason.
 *
 * ## An implication, not an equivalence
 *
 * `customer_account_id is null or organization_id is not null` is FR-010 and
 * FR-011 together and nothing wider: an **owned** row has an organisation, an
 * **ownerless** row need not — an anonymous basket is a representable state and
 * this table is full of them. The equivalence
 * (`(customer_account_id is null) = (organization_id is null)`) would close one
 * further shape, an ownerless row still carrying an organisation, at the price
 * of writing R-6's answer into the schema while R-6 is open. D-187 takes the
 * implication for that reason: do not encode an open question in a constraint.
 *
 * ## No foreign key
 *
 * Deliberately, and matching what this column has always been. D-187 withdraws
 * `r1-spike.md` §8's `on delete set null` recommendation as contradicting
 * FR-011 — it produces a row that names an account and no organisation, which
 * is exactly the state below being made unreachable, and under this constraint
 * it would abort an unrelated organisation delete with a message about a table
 * the operator was not touching. If one is ever taken here it must be
 * `restrict`, and it is not this migration's decision.
 *
 * ## Derive, then count, then refuse — never delete
 *
 * These rows are buyers' baskets. The derivation is the account's own
 * organisation, which is total since D-178 made `customer_accounts.organization_id`
 * `NOT NULL`, so the only way to survive it is a `customer_account_id` pointing
 * at a row that is gone — this table carries no foreign key on that column, so
 * that is a real branch and not a formality. The migration raises with the
 * count and up to twenty ids and deletes nothing (D-184), in the shape the
 * D-178 migration established.
 *
 * `carts` does not declare `customer_accounts` in its manifest `dependencies`
 * and needs no entry for this: `customer_accounts` is created by
 * `organizations/20260424T205317_organizations_init.ts`, far below
 * `BASELINE_THROUGH`, so the table this reads exists whatever this module's
 * position in the dependency order. No foreign key is added, so
 * `fk-dependency-drift` has nothing to say either.
 *
 * The standing guard is
 * `backend/test/integration/tenancy/customer-scoped-organization-completeness.test.ts`,
 * which derives its population from the ORM's metadata rather than from a list
 * — so the next `@CustomerScoped` class to gain this column is covered by
 * gaining it.
 */
export class Migration20260830T112911CartsOrganizationAttributionCheck extends Migration {
  override async up(): Promise<void> {
    // 1. Derive the organisation from the account that owns the cart. Expected
    //    to move nothing: `CartService` has stamped it on the owned-create
    //    branch since the column existed, and the anonymous branch never
    //    becomes owned (the merge completes the anonymous cart rather than
    //    re-owning it). "Expected" is not "measured on your database", which is
    //    why the statement runs and step 2 counts what it left.
    this.addSql(`
      update "carts" c
      set "organization_id" = ca."organization_id"
      from "customer_accounts" ca
      where ca."id" = c."customer_account_id"
        and c."organization_id" is null;
    `);

    // 2. Count what is left and refuse. A cart can only be here if its
    //    `customer_account_id` names an account that no longer exists — the
    //    account's own organisation is `NOT NULL` since D-178 — so the row is
    //    owned by nobody the platform can name. The merge request that hits
    //    this decides what to do with it; deleting a buyer's basket is never
    //    it.
    this.addSql(`
      do $$
      declare
        remaining bigint;
        sample text;
      begin
        select count(*) into remaining
          from "carts"
         where "customer_account_id" is not null
           and "organization_id" is null;
        if remaining > 0 then
          select string_agg(id::text, ', ') into sample from (
            select "id" from "carts"
             where "customer_account_id" is not null
               and "organization_id" is null
             order by "id" limit 20
          ) s;
          raise exception
            'D-187: % carts row(s) still name a customer account with organization_id IS NULL after derivation. First ids: %. Every customer account has an organization (D-178), so these rows name an account that is gone. Do not delete them - decide what they belong to.',
            remaining, sample;
        end if;
      end $$;
    `);

    // 3. The constraint.
    this.addSql(`
      alter table "carts"
        add constraint "carts_organization_attribution_chk"
        check ("customer_account_id" is null or "organization_id" is not null);
    `);
  }

  override async down(): Promise<void> {
    // Drop the constraint, and nothing else. The organisations step 1 derived
    // were a defect rather than data — a row that named an account already
    // belonged to that account's organisation — so there is nothing to undo.
    this.addSql(
      `alter table "carts" drop constraint if exists "carts_organization_attribution_chk";`,
    );
  }
}
