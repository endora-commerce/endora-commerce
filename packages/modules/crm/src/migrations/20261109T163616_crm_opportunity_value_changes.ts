import { Migration } from '@mikro-orm/migrations';

/**
 * An Opportunity's own record of the values its writes changed (issue #470,
 * D-288; `specs/conventions/audit-state.md` §3).
 *
 * The platform audit log is not tenant-scoped, so from this release a
 * `crm.opportunity.*` audit entry names the fields a write changed and never
 * their values: the title, the description, the value and currency, the
 * contact person and Organization, tag names, custom-field values, a
 * transition's reason, an Event's name and an attachment's file name. The
 * Opportunity's change history still shows them, from here. One row per
 * Command that changed one of them, written in that Command's transaction; the
 * audit entry points at it by `valueChangeId`.
 *
 * `before` is `null` for something that only arrived and `after` for something
 * that went; each side holds only the keys that changed. A child of
 * `crm_opportunities` like the nine others — no tenant column of its own, gone
 * with its Opportunity (`on delete cascade`). No other module's table is
 * referenced.
 *
 * Audit entries written before this migration are not touched: they keep the
 * values they were written with, and the history serves them as they are.
 */
export class Migration20261109T163616CrmOpportunityValueChanges extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "crm_opportunity_value_changes" (
        "id" uuid not null default gen_random_uuid(),
        "opportunity_id" uuid not null,
        "before" jsonb null,
        "after" jsonb null,
        "at" timestamptz not null default now(),
        constraint "crm_opportunity_value_changes_pkey" primary key ("id"),
        constraint "crm_opportunity_value_changes_opportunity_fk" foreign key ("opportunity_id")
          references "crm_opportunities" ("id") on delete cascade
      );
    `);
    this.addSql(
      `create index "crm_opportunity_value_changes_opportunity_id_index" on "crm_opportunity_value_changes" ("opportunity_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "crm_opportunity_value_changes" cascade;');
  }
}
