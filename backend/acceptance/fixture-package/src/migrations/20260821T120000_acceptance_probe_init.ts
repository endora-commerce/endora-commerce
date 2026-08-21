import { Migration } from '@mikro-orm/migrations';

/**
 * The one migration the fixture package ships.
 *
 * Named by the repository's own convention
 * (`<YYYYMMDDTHHmmss>_<module-segment>_<slug>.ts`, class
 * `Migration<STAMP><PascalCaseTail>`) even though nothing in this repository
 * scans this directory: the class name is what `mikro_orm_migrations` persists,
 * so it is the string assertion A1 looks for, and a package that named its
 * classes some other way would collide with a host's the first time two
 * authors picked the same slug.
 *
 * The stamp is deliberately after `BASELINE_THROUGH` (`20260801T000000`): a
 * package's chain is ordered by the module graph, and a stamp inside the frozen
 * historical prefix would be ordered by a history this package was never part
 * of (D-114).
 *
 * `up()` creates the table, its tenant column and one named index. A3 reads all
 * three back out of `information_schema` — that is what distinguishes "the
 * migration body ran" from "a row was written into `mikro_orm_migrations`".
 */
export class Migration20260821T120000AcceptanceProbeInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "acceptance_probe_rows" (
        "id" uuid not null,
        "organization_id" uuid null,
        "label" text not null,
        "created_at" timestamptz not null default now(),
        constraint "acceptance_probe_rows_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "acceptance_probe_rows_organization_id_index" on "acceptance_probe_rows" ("organization_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "acceptance_probe_rows" cascade;`);
  }
}
