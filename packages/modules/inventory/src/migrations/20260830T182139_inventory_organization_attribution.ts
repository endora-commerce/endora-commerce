import { Migration } from '@mikro-orm/migrations';

/**
 * D-187 — `availability_notifications` gains its organisation, and a row that
 * names a customer account carries one.
 *
 * Feature 087 Group B, class 3 of 4 (`specs/087-tenant-scope-enforcement/`).
 * `AvailabilityNotification` is `@CustomerScoped`, and until this migration the
 * `allowed-set` arm of `customerFilterCond` had no column to grant on: a sales
 * representative assigned to the buyer's own organisation was shown **none** of
 * their back-in-stock subscriptions and told so, through the
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
 * **ownerless** row need not. This table is ownerless by construction for the
 * storefront's anonymous "notify me when in stock" dialog — feature 010 dropped
 * `NOT NULL` from `customer_account_id` and added `an_recipient_check`
 * (`20260503T182812_inventory_workflow.ts`), whose whole purpose is to admit a
 * row whose only recipient is an e-mail address — and who such a row belongs to
 * is R-6's open question. The equivalence would answer it in the schema, which
 * D-187 declines to do.
 *
 * Unlike `pwa`, nothing here can produce the opposite shape. There is no
 * association write on this table: `customer_account_id` is written once, in
 * `AvailabilityNotificationService.subscribe`'s `em.create`, and never assigned
 * on an existing row (grep of `packages/modules/inventory/src` for
 * `customerAccountId`: one write, the rest reads). So an ownerless row carrying
 * an organisation is not reachable, and the shape the implication leaves open
 * is empty here rather than held by a test.
 *
 * ## No foreign key
 *
 * Matching `Cart`, `Comparison` and `PushSubscription`, none of which carries
 * one. D-187 withdraws `r1-spike.md` §8's `on delete set null` recommendation
 * as contradicting FR-011: it produces a row that names an account and no
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
 * with as much care as the derivation: like `push_subscriptions` and unlike
 * `comparisons`, `availability_notifications` has **no foreign key** on
 * `customer_account_id` — the core foundation migration
 * (`20260424T165847_core_foundation_init.ts`) declares the column and an index
 * and constrains nothing — so a row naming an account that is gone is
 * representable here.
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
 * established and `20260830T112911_carts_organization_attribution_check.ts` and
 * `20260830T172022_pwa_organization_attribution.ts` repeated. Deleting would be
 * particularly wrong here: a queued subscription is a promise to a customer
 * that they will be told when the product returns, and a migration is not the
 * place to break one.
 *
 * ## Ownership, and nothing to declare in the manifest
 *
 * `availability_notifications` is the one Group B table whose `create table` is
 * not its module's — it comes from the core foundation migration. This column
 * migration is still `inventory`'s, because the entity is, and module ownership
 * is what the registry and a hard uninstall key on (D-142).
 *
 * `inventory` already declares both `customer_accounts` and `organizations` in
 * its manifest `dependencies`, so the table this reads is created before this
 * runs. No foreign key is added, so `fk-dependency-drift` has nothing to say
 * either, and a migration naming another module's table is outside
 * `check:module-boundary`'s population by that check's own rule.
 *
 * The standing guard is
 * `backend/test/integration/tenancy/customer-scoped-organization-completeness.test.ts`,
 * which derives its population from the ORM's metadata rather than from a list
 * — so this class is covered by gaining the column, with no edit to that file.
 */
export class Migration20260830T182139InventoryOrganizationAttribution extends Migration {
  override async up(): Promise<void> {
    // 1. The column. Nullable, because an anonymous subscriber legitimately has
    //    none (FR-011) and `an_recipient_check` exists to admit exactly that
    //    row.
    this.addSql(
      `alter table "availability_notifications" add column "organization_id" uuid null;`,
    );

    // 2. Derive the organisation from the account that owns the subscription.
    //    Every account carries one since D-178, including a soft-deleted or
    //    anonymised one, so this is total for every row whose account is still
    //    there. Step 3 is about the rows for which it is not.
    this.addSql(`
      update "availability_notifications" an
      set "organization_id" = ca."organization_id"
      from "customer_accounts" ca
      where ca."id" = an."customer_account_id"
        and an."organization_id" is null;
    `);

    // 3. Count what is left and refuse. This table has no foreign key on
    //    `customer_account_id`, so a dangling account id is representable and
    //    this branch is real. It deletes nothing (D-184).
    this.addSql(`
      do $$
      declare
        remaining bigint;
        sample text;
      begin
        select count(*) into remaining
          from "availability_notifications"
         where "customer_account_id" is not null
           and "organization_id" is null;
        if remaining > 0 then
          select string_agg(id::text, ', ') into sample from (
            select "id" from "availability_notifications"
             where "customer_account_id" is not null
               and "organization_id" is null
             order by "id" limit 20
          ) s;
          raise exception
            'D-187: % availability_notifications row(s) still name a customer account with organization_id IS NULL after derivation. First ids: %. Every customer account has an organization (D-178) and none is ever hard-deleted, so these rows name an account that is gone. Do not delete them - find out how they got here.',
            remaining, sample;
        end if;
      end $$;
    `);

    // 4. The constraint.
    this.addSql(`
      alter table "availability_notifications"
        add constraint "availability_notifications_organization_attribution_chk"
        check ("customer_account_id" is null or "organization_id" is not null);
    `);

    // 5. The index the entity property declares. Whole rather than partial, and
    //    named `<table>_<column>_index`, because that is this table's own style
    //    for an entity-declared single-column index:
    //    `availability_notifications_customer_account_id_index` is what
    //    `@Index()` on `customerAccountId` produced and it is unfiltered. The
    //    `an_*` names on this table belong to the hand-written composite index
    //    and the two check constraints, which are a different kind of object.
    //    `pwa`'s index is partial for the same reason in reverse — it followed
    //    `push_subscriptions_customer_idx`, which is partial.
    this.addSql(`
      create index "availability_notifications_organization_id_index"
        on "availability_notifications" ("organization_id");
    `);
  }

  override async down(): Promise<void> {
    // The constraint, the index and the column. The organisations step 2
    // derived go with the column they were written into — there is nothing to
    // preserve, because each of them was already implied by the account its row
    // names.
    this.addSql(
      `alter table "availability_notifications" drop constraint if exists "availability_notifications_organization_attribution_chk";`,
    );
    this.addSql(`drop index if exists "availability_notifications_organization_id_index";`);
    this.addSql(
      `alter table "availability_notifications" drop column if exists "organization_id";`,
    );
  }
}
