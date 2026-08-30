import { Migration } from '@mikro-orm/migrations';

/**
 * D-187 — `push_subscriptions` gains its organisation, and a row that names a
 * customer account carries one.
 *
 * Feature 087 Group B, class 2 of 4 (`specs/087-tenant-scope-enforcement/`).
 * `PushSubscription` is `@CustomerScoped`, and until this migration the
 * `allowed-set` arm of `customerFilterCond` had no column to grant on: a sales
 * representative assigned to the buyer's own organisation was shown **none** of
 * their subscribed devices and told so, through the
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
 * **ownerless** row need not. This table is ownerless by construction for every
 * device that subscribes before anybody signs in (FR-023 — `customer_account_id`
 * has been nullable since `20260625T144228_pwa_init.ts`), and who such a device
 * belongs to is R-6's open question. The equivalence would answer it in the
 * schema, which D-187 declines to do.
 *
 * **What that deliberately leaves open, and where it is held instead.** The
 * equivalence would also close the opposite shape — an **ownerless** row still
 * carrying an organisation — and this table is the one in Group B that can
 * produce it. Its write is an upsert on `endpoint`, so re-subscribing a
 * previously owned device anonymously clears the account, and an implication
 * says nothing about the organisation left behind. That row would be visible to
 * a representative of an organisation it no longer belongs to. It is closed at
 * the write instead of in the schema: `PushSubscriptionService` writes both
 * columns from one resolved owner value, so there is no branch in which one
 * moves without the other, and `admin-and-storefront.contract.test.ts` asserts
 * the de-association end to end. A constraint here would have bought the same
 * guarantee at the price of deciding R-6.
 *
 * ## No foreign key
 *
 * Matching `Cart` and `Comparison`, neither of which carries one. D-187
 * withdraws `r1-spike.md` §8's `on delete set null` recommendation as
 * contradicting FR-011: it produces a row that names an account and no
 * organisation, which is precisely the state this migration makes unreachable,
 * and under the constraint below it would abort an unrelated organisation
 * delete with a message about a table the operator was not touching. If one is
 * ever taken here it must be `restrict`, and it is not this migration's
 * decision.
 *
 * ## Derive, then count, then refuse — never delete
 *
 * The derivation is the owning account's own organisation. **On this table the
 * refusal is a real branch, not a formality**, and that is why it is written
 * with as much care as the derivation: unlike `comparisons`, `push_subscriptions`
 * has **no foreign key** on `customer_account_id` (the init migration declares
 * the column `uuid null` and constrains nothing), so a row naming an account
 * that is gone is representable here.
 *
 * It is nevertheless empty today, and the reason is worth knowing rather than
 * hoping: a customer account is never hard-deleted in this tree.
 * `customer-account-lifecycle-ports.ts` soft-deletes, restores and
 * **anonymises** — the last one rewrites the e-mail and the name and keeps the
 * row — and every one of those still satisfies `organization_id NOT NULL`
 * (D-178), so it still derives. Change any of that and the count below is the
 * only thing that would notice.
 *
 * It raises with the count and up to twenty ids and deletes nothing (D-184), in
 * the shape `20260825T141659_customer_accounts_organization_required.ts`
 * established and `20260830T112911_carts_organization_attribution_check.ts`
 * repeated.
 *
 * ## Nothing to declare in the manifest
 *
 * `pwa` already declares both `customer_accounts` and `organizations` in its
 * manifest `dependencies`, so the table this reads is created before this runs.
 * No foreign key is added, so `fk-dependency-drift` has nothing to say either,
 * and a migration naming another module's table is outside
 * `check:module-boundary`'s population by that check's own rule.
 *
 * The standing guard is
 * `backend/test/integration/tenancy/customer-scoped-organization-completeness.test.ts`,
 * which derives its population from the ORM's metadata rather than from a list
 * — so this class is covered by gaining the column, with no edit to that file.
 */
export class Migration20260830T172022PwaOrganizationAttribution extends Migration {
  override async up(): Promise<void> {
    // 1. The column. Nullable, because an anonymous device legitimately has
    //    none (FR-011/FR-023) and this table is mostly anonymous in practice.
    this.addSql(`alter table "push_subscriptions" add column "organization_id" uuid null;`);

    // 2. Derive the organisation from the account that owns the subscription.
    //    Every account carries one since D-178, including a soft-deleted or
    //    anonymised one, so this is total for every row whose account is still
    //    there. Step 3 is about the rows for which it is not.
    this.addSql(`
      update "push_subscriptions" ps
      set "organization_id" = ca."organization_id"
      from "customer_accounts" ca
      where ca."id" = ps."customer_account_id"
        and ps."organization_id" is null;
    `);

    // 3. Count what is left and refuse. This table has no foreign key on
    //    `customer_account_id`, so a dangling account id is representable and
    //    this branch is real. It deletes nothing (D-184): a subscribed device
    //    is a customer's, and a migration is not the place to decide that one
    //    of them should stop receiving notifications.
    this.addSql(`
      do $$
      declare
        remaining bigint;
        sample text;
      begin
        select count(*) into remaining
          from "push_subscriptions"
         where "customer_account_id" is not null
           and "organization_id" is null;
        if remaining > 0 then
          select string_agg(id::text, ', ') into sample from (
            select "id" from "push_subscriptions"
             where "customer_account_id" is not null
               and "organization_id" is null
             order by "id" limit 20
          ) s;
          raise exception
            'D-187: % push_subscriptions row(s) still name a customer account with organization_id IS NULL after derivation. First ids: %. Every customer account has an organization (D-178) and none is ever hard-deleted, so these rows name an account that is gone. Do not delete them - find out how they got here.',
            remaining, sample;
        end if;
      end $$;
    `);

    // 4. The constraint.
    this.addSql(`
      alter table "push_subscriptions"
        add constraint "push_subscriptions_organization_attribution_chk"
        check ("customer_account_id" is null or "organization_id" is not null);
    `);

    // 5. The index the entity property declares. Partial, matching this table's
    //    own owner index — `push_subscriptions_customer_idx` is
    //    `("customer_account_id") where "customer_account_id" is not null` —
    //    for the same reason: the column is null on every anonymous device, and
    //    the reader is an organisation-scoped list.
    this.addSql(`
      create index "push_subscriptions_organization_idx"
        on "push_subscriptions" ("organization_id")
        where "organization_id" is not null;
    `);
  }

  override async down(): Promise<void> {
    // The constraint, the index and the column. The organisations step 2
    // derived go with the column they were written into — there is nothing to
    // preserve, because each of them was already implied by the account its row
    // names.
    this.addSql(
      `alter table "push_subscriptions" drop constraint if exists "push_subscriptions_organization_attribution_chk";`,
    );
    this.addSql(`drop index if exists "push_subscriptions_organization_idx";`);
    this.addSql(`alter table "push_subscriptions" drop column if exists "organization_id";`);
  }
}
