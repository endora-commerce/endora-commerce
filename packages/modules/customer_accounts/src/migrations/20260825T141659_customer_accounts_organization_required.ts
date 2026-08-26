import { Migration } from '@mikro-orm/migrations';

/**
 * D-178 — `customer_accounts.organization_id` becomes `NOT NULL`.
 *
 * The column was relaxed by `20260611T140351_customer_accounts_organization_optional`
 * for feature 026 US2 ("Customer accounts may exist without an Organization"), a
 * design feature 051 replaced and D-178 confirms is dead: every transacting
 * customer is backed by an Organization, an individual by a single-member
 * **personal** one, and there is no "no-organization" scoping path
 * (Constitution XI).
 *
 * **The constraint is the only refusal available.** MikroORM applies its tenant
 * filter to `SELECT` / `UPDATE` / `DELETE` and not to `INSERT`, so no guard can
 * stop a tenant-less account being written; the column can.
 *
 * ## Provision, then count, then refuse — never delete
 *
 * These rows are customer logins: a person's credentials, the owner of their
 * order history and the parent of their address book. A migration that deleted
 * one to satisfy a constraint would be deleting a customer, so this one
 * provisions instead and raises on whatever it could not provision.
 *
 * Feature 051's backfill
 * (`organizations/20260717T151403_organizations_personal_organizations`) ran the
 * same provisioning once. It closed the population as of the moment it ran and
 * closed no write path, so three producers went on filling it: standalone
 * registration's two-flush window, federated sign-in (which provisioned no
 * organisation at all), and the admin "un-assign" button. All three are closed
 * in the merge request that carries this migration — without that, the
 * constraint would convert three silent defects into three runtime failures.
 *
 * Two deliberate differences from that backfill:
 *
 *  - **Soft-deleted accounts are included.** 051 skipped them with its own
 *    `and ca."deleted_at" is null`. A soft-deleted row still has to satisfy the
 *    constraint, and `customer_account.restored` would otherwise resurrect an
 *    account the platform cannot scope.
 *  - **The insert skips an account whose personal organisation already exists**,
 *    and a second statement links it. `tax_id` is derived from the account id
 *    and is globally unique, so an account that was provisioned once and then
 *    un-assigned would otherwise collide — the migration would abort on a
 *    constraint violation rather than on the sentence it wants to say.
 *
 * The provisioning mirrors `PersonalOrganizationService.provisionFor`: name from
 * the trimmed "first last" or else the e-mail local part, `tax_id` the account
 * UUID with the dashes stripped (32 hex characters — an individual has no
 * company tax id), `vat_status = 'vat_exempt'`, `status = 'active'`,
 * `is_personal = true`, and the placeholder registered address the column's
 * `not null` demands.
 *
 * `organizations` is a hard `dependencies` entry of this module's manifest, so
 * that module's tables exist by the time this runs.
 */
export class Migration20260825T141659CustomerAccountsOrganizationRequired extends Migration {
  override async up(): Promise<void> {
    // 1. Provision a personal organisation for every account that has none and
    //    whose derived one does not already exist.
    this.addSql(`
      insert into "organizations" (
        "id", "name", "tax_id", "status", "vat_status", "is_personal",
        "registered_address", "created_at", "updated_at"
      )
      select
        gen_random_uuid(),
        coalesce(
          nullif(trim(coalesce(ca."first_name", '') || ' ' || coalesce(ca."last_name", '')), ''),
          split_part(ca."email", '@', 1)
        ),
        replace(ca."id"::text, '-', ''),
        'active',
        'vat_exempt',
        true,
        '{"street":"-","city":"-","postalCode":"-","country":"PL"}'::json,
        now(), now()
      from "customer_accounts" ca
      where ca."organization_id" is null
        and not exists (
          select 1 from "organizations" o
          where o."tax_id" = replace(ca."id"::text, '-', '')
        );
    `);

    // 2. Link every such account to it — both the ones just created and the ones
    //    whose organisation survived an earlier provisioning (the state an
    //    un-assigned account was left in before this ruling).
    //
    //    `is_personal` is the load-bearing word. Without it, an account whose
    //    derived `tax_id` happened to be held by a **company** organisation
    //    would be linked into that company's tenant — a stranger's — silently.
    //    With it, such an account is served by neither statement and falls
    //    through to the refusal below, which is what step 3's message describes.
    this.addSql(`
      update "customer_accounts" ca
      set "organization_id" = o."id"
      from "organizations" o
      where ca."organization_id" is null
        and o."is_personal" = true
        and o."tax_id" = replace(ca."id"::text, '-', '');
    `);

    // 3. Count what is left and refuse. It can only be non-zero if an account's
    //    provisioning failed — a `tax_id` collision with a company organisation
    //    is the plausible one, since that column is globally unique. The merge
    //    request that hits this decides what to do; deleting is never it.
    this.addSql(`
      do $$
      declare
        remaining bigint;
        sample text;
      begin
        select count(*) into remaining
          from "customer_accounts" where "organization_id" is null;
        if remaining > 0 then
          select string_agg(id::text, ', ') into sample from (
            select "id" from "customer_accounts"
            where "organization_id" is null order by "id" limit 20
          ) s;
          raise exception
            'D-178: % customer_accounts row(s) still have organization_id IS NULL after provisioning. First ids: %. These rows are customer logins - do not delete them. The likely cause is a tax_id collision on organizations.tax_id, which is globally unique.',
            remaining, sample;
        end if;
      end $$;
    `);

    // 4. The constraint.
    this.addSql(`alter table "customer_accounts" alter column "organization_id" set not null;`);
  }

  override async down(): Promise<void> {
    // Re-drop the constraint, and nothing else. The NULLs this migration filled
    // in were a defect rather than data, so there is nothing to restore — and
    // the personal organisations it created are left in place, because an
    // account still points at each of them.
    this.addSql(`alter table "customer_accounts" alter column "organization_id" drop not null;`);
  }
}
