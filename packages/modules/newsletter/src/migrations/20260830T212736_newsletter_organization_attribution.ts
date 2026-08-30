import { Migration } from '@mikro-orm/migrations';

/**
 * D-187 — `newsletter_subscribers` gains its organisation, and a row that names
 * a customer account carries one.
 *
 * Feature 087 Group B, class 4 of 4 and the last of the five
 * (`specs/087-tenant-scope-enforcement/`). `NewsletterSubscriber` is
 * `@CustomerScoped`, and until this migration the `allowed-set` arm of
 * `customerFilterCond` had no column to grant on: a sales representative
 * assigned to the buyer's own organisation was shown **none** of their
 * subscribers. The column is what turns that into an answer.
 *
 * ## The column and the read arrive together, on purpose
 *
 * `customerOrganizationColumn` asks the ORM's own metadata whether the filtered
 * entity carries `organizationId`, **per query**, so the entity property in
 * this same merge request is what switches the grant on — there is no third
 * artefact, no flag and no staging. At the same instant the
 * `ORGANIZATION_ATTRIBUTION_PENDING` disclosure retires itself: it is keyed on
 * the column's *absence*.
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
 * storefront's sign-up form — `POST /api/v1/newsletter/subscribe` passes no
 * account at all, so every subscriber who has never signed in is such a row,
 * and on this table they are the majority rather than the exception. Who they
 * belong to is R-6's open question. The equivalence would answer it in the
 * schema, which D-187 declines to do.
 *
 * The shape the implication leaves open — an **ownerless** row still carrying
 * an organisation — is unreachable here, for `inventory`'s reason rather than
 * `pwa`'s. `subscriber.service.ts` writes `customer_account_id` in exactly two
 * places and both of them *acquire* an owner: the `em.create` on first
 * subscribe, and the adoption line that fills in the account when a subscriber
 * who signed up anonymously later signs in. Nothing in this module ever clears
 * it (grep of `packages/modules/newsletter/src` for `customerAccountId`: two
 * writes, both assignments of a non-null id, the rest reads). So there is no
 * de-association direction for the constraint to be silent about.
 *
 * ## The e-mail address is not a derivation
 *
 * `newsletter_subscribers.email` is globally unique and `customer_accounts`
 * has an `email` too, so the backfill below could have matched them and
 * attributed far more rows. It deliberately does not. That match would claim
 * rows the schema does not link, silently and irreversibly, for whoever
 * happened to sign up with the address their employer later registered — it is
 * R-6 answer (2) guessed rather than decided. The only derivation is
 * `customer_account_id`.
 *
 * ## No foreign key
 *
 * Matching `Cart`, `Comparison`, `PushSubscription` and
 * `AvailabilityNotification`, none of which carries one. D-187 withdraws
 * `r1-spike.md` §8's `on delete set null` recommendation as contradicting
 * FR-011: it produces a row that names an account and no organisation, which is
 * precisely the state this migration makes unreachable, and under the
 * constraint below it would abort an unrelated organisation delete with a
 * message about a table the operator was not touching. If one is ever taken
 * here it must be `restrict`, and it is not this migration's decision.
 *
 * ## Derive, then count, then refuse — never delete
 *
 * The derivation is the owning account's own organisation. **On this table the
 * refusal is a real branch, not a formality**: like `push_subscriptions` and
 * `availability_notifications`, and unlike `comparisons`,
 * `newsletter_subscribers` has **no foreign key** on `customer_account_id` —
 * `20260629T200954_newsletter_init.ts` declares it `uuid null` and constrains
 * nothing — so a row naming an account that is gone is representable here.
 *
 * It is nevertheless empty today, and the reason is worth knowing rather than
 * hoping: a customer account is never hard-deleted in this tree.
 * `customer-account-lifecycle-ports.ts` soft-deletes, restores and
 * **anonymises** — the last one rewrites the e-mail and the name and keeps the
 * row — and every one of those still satisfies `organization_id NOT NULL`
 * (D-178), so it still derives. Change any of that and the count below is the
 * only thing that would notice. The anonymise path is worth a second look on
 * *this* table in particular, because it rewrites the very column an e-mail
 * match would have keyed on; deriving from `customer_account_id` is unaffected
 * by it.
 *
 * It raises with the count and up to twenty ids and deletes nothing (D-184), in
 * the shape `20260825T141659_customer_accounts_organization_required.ts`
 * established and the three Group B migrations before this one repeated.
 * Deleting would be particularly wrong here: a subscriber row is a consent
 * record, and dropping one destroys the evidence that the address may be
 * mailed at all.
 *
 * ## Nothing to declare in the manifest
 *
 * `newsletter` declares `customers` in its manifest `dependencies`, whose
 * transitive closure reaches `customer_accounts` and `organizations`, so the
 * table this reads is created before this runs. No foreign key is added, so
 * `fk-dependency-drift` has nothing to say either, and a migration naming
 * another module's table is outside `check:module-boundary`'s population by
 * that check's own rule.
 *
 * The standing guard is
 * `backend/test/integration/tenancy/customer-scoped-organization-completeness.test.ts`,
 * which derives its population from the ORM's metadata rather than from a list
 * — so this class is covered by gaining the column, with no edit to that file.
 */
export class Migration20260830T212736NewsletterOrganizationAttribution extends Migration {
  override async up(): Promise<void> {
    // 1. The column. Nullable, because a storefront sign-up legitimately has
    //    none (FR-011) and on this table that is the ordinary case rather than
    //    the edge.
    this.addSql(`alter table "newsletter_subscribers" add column "organization_id" uuid null;`);

    // 2. Derive the organisation from the account that owns the subscription.
    //    Every account carries one since D-178, including a soft-deleted or
    //    anonymised one, so this is total for every row whose account is still
    //    there. Step 3 is about the rows for which it is not.
    this.addSql(`
      update "newsletter_subscribers" ns
      set "organization_id" = ca."organization_id"
      from "customer_accounts" ca
      where ca."id" = ns."customer_account_id"
        and ns."organization_id" is null;
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
          from "newsletter_subscribers"
         where "customer_account_id" is not null
           and "organization_id" is null;
        if remaining > 0 then
          select string_agg(id::text, ', ') into sample from (
            select "id" from "newsletter_subscribers"
             where "customer_account_id" is not null
               and "organization_id" is null
             order by "id" limit 20
          ) s;
          raise exception
            'D-187: % newsletter_subscribers row(s) still name a customer account with organization_id IS NULL after derivation. First ids: %. Every customer account has an organization (D-178) and none is ever hard-deleted, so these rows name an account that is gone. Do not delete them - they are consent records - and do not match them by e-mail address, which is R-6 guessed. Find out how they got here.',
            remaining, sample;
        end if;
      end $$;
    `);

    // 4. The constraint.
    this.addSql(`
      alter table "newsletter_subscribers"
        add constraint "newsletter_subscribers_organization_attribution_chk"
        check ("customer_account_id" is null or "organization_id" is not null);
    `);

    // 5. The index the entity property declares, named
    //    `newsletter_subscribers_organization_idx` — **this table's own style**
    //    and not the previous batch's. Every index the init migration wrote
    //    here is `newsletter_subscribers_<subject>_idx`, and the one other
    //    `*_id` column it indexes is spelled with the subject alone:
    //    `sales_channel_id` is `newsletter_subscribers_channel_idx`, not
    //    `..._sales_channel_id_index`. `comparisons` uses `idx_<table>_<col>`,
    //    `pwa` uses `<table>_<col>_idx` and `inventory` uses
    //    `<table>_<col>_index`; each followed its own table, and this follows
    //    this one. Whole rather than partial, like every index above it here.
    this.addSql(`
      create index "newsletter_subscribers_organization_idx"
        on "newsletter_subscribers" ("organization_id");
    `);
  }

  override async down(): Promise<void> {
    // The constraint, the index and the column. The organisations step 2
    // derived go with the column they were written into — there is nothing to
    // preserve, because each of them was already implied by the account its row
    // names.
    this.addSql(
      `alter table "newsletter_subscribers" drop constraint if exists "newsletter_subscribers_organization_attribution_chk";`,
    );
    this.addSql(`drop index if exists "newsletter_subscribers_organization_idx";`);
    this.addSql(
      `alter table "newsletter_subscribers" drop column if exists "organization_id";`,
    );
  }
}
