import { Migration } from '@mikro-orm/migrations';

/**
 * `specs/180-off-platform-complaints/` phase A (data-model §1.3): who authorized a
 * case, and which statuses e-mail the customer on entry.
 *
 * 1. `return_cases.authorized_by_admin_user_id` — the administrator whose action
 *    moved the case into `authorized` (FR-A40). No FK: `admin_users` owns that
 *    table, and a removed administrator stays an id the detail calls a *former
 *    administrator* (FR-A42).
 * 2. `return_statuses.notify_customer_on_entry` — FR-A30, off for every status.
 * 3. The backfill (FR-A43, research R-8): for a case authorized before this
 *    release, the actor of the newest `return.status_changed` audit entry into
 *    `authorized` that names an administrator. It reads the kernel-owned
 *    `audit_log_entries` — outside `check:module-boundary`'s R1 and R2 — and writes
 *    only `return_cases`. It fills nulls only, so a second run changes nothing; a
 *    case whose entry was never written or was pruned stays `null` (*unknown*).
 */
export class Migration20261113T145001ReturnsAuthorizerStatusNotifications extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "return_cases" add column if not exists "authorized_by_admin_user_id" uuid null;');
    this.addSql(
      'alter table "return_statuses" add column if not exists "notify_customer_on_entry" boolean not null default false;',
    );
    this.addSql(`
      update "return_cases" rc
         set "authorized_by_admin_user_id" = (
           select e."actor_admin_user_id"
             from "audit_log_entries" e
            where e."object_type" = 'return_case'
              and e."object_id" = rc."id"::text
              and e."action" = 'return.status_changed'
              and e."state_after"->>'statusCode' = 'authorized'
              and e."actor_admin_user_id" is not null
            order by e."acted_at" desc
            limit 1
         )
       where rc."authorized_at" is not null
         and rc."authorized_by_admin_user_id" is null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql('alter table "return_cases" drop column if exists "authorized_by_admin_user_id";');
    this.addSql('alter table "return_statuses" drop column if exists "notify_customer_on_entry";');
  }
}
