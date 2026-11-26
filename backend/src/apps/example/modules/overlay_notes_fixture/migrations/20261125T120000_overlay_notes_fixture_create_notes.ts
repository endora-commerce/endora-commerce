import { Migration } from '@mikro-orm/migrations';

/**
 * `overlay_notes_fixture` — its one table (`specs/190-overlay-full-modules/` #1850).
 *
 * Read from this directory file by file and applied under the foreign-schema
 * guard with no exemption (OR-4): it creates the table its own entity maps and
 * references `organizations`, which its manifest declares.
 */
export class Migration20261125T120000OverlayNotesFixtureCreateNotes extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "overlay_fixture_notes" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "body" text not null,
        "created_at" timestamptz not null,
        constraint "overlay_fixture_notes_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "overlay_fixture_notes_organization_id_index" on "overlay_fixture_notes" ("organization_id");`,
    );
    this.addSql(`
      alter table "overlay_fixture_notes"
        add constraint "overlay_fixture_notes_organization_id_foreign"
        foreign key ("organization_id") references "organizations" ("id")
        on update cascade on delete cascade;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "overlay_fixture_notes" cascade;`);
  }
}
