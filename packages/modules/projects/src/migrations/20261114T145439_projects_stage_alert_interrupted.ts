import { Migration } from '@mikro-orm/migrations';

/**
 * A Stage deadline alert whose pass died between claiming and settling it is
 * marked `interrupted` by a later pass (issue #462, as CRM's reminder sweep
 * marks its own). The outcome constraint gains the value, and a partial index
 * on `claimed_at` over the unsettled rows keeps the question the sweep and its
 * probe ask every tick — "which claims are older than the bound and still
 * unsettled?" — a lookup. The rows themselves are untouched.
 */
export class Migration20261114T145439ProjectsStageAlertInterrupted extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "project_stage_alert_deliveries" drop constraint "project_stage_alert_deliveries_outcome_check";`,
    );
    this.addSql(`
      alter table "project_stage_alert_deliveries"
        add constraint "project_stage_alert_deliveries_outcome_check"
        check ("outcome" is null or "outcome" in ('bell', 'bell_email', 'email', 'no_recipient', 'undeliverable', 'interrupted'));
    `);
    this.addSql(
      `create index "project_stage_alert_deliveries_unsettled_idx" on "project_stage_alert_deliveries" ("claimed_at") where "outcome" is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "project_stage_alert_deliveries_unsettled_idx";`);
    // The narrower constraint has no place for the value: an interrupted claim
    // goes back to what it was before it was marked — unsettled.
    this.addSql(`update "project_stage_alert_deliveries" set "outcome" = null where "outcome" = 'interrupted';`);
    this.addSql(
      `alter table "project_stage_alert_deliveries" drop constraint "project_stage_alert_deliveries_outcome_check";`,
    );
    this.addSql(`
      alter table "project_stage_alert_deliveries"
        add constraint "project_stage_alert_deliveries_outcome_check"
        check ("outcome" is null or "outcome" in ('bell', 'bell_email', 'email', 'no_recipient', 'undeliverable'));
    `);
  }
}
