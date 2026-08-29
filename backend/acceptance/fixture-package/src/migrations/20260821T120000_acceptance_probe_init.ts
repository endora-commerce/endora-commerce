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
 * The stamp is after `BASELINE_THROUGH` (`20260801T000000`) because it is this
 * package's first migration and there was nothing to place it before — **not**
 * because a lower stamp would have joined the frozen historical prefix. It
 * could not: since T004b/D-114 baseline membership is
 * `origin === 'core' && stamp <= BASELINE_THROUGH`, and `package-runtime.ts`
 * tags every entry it reads out of a package `origin: 'external'`
 * unconditionally, so a package's stamp is never compared against the watermark
 * at all. That origin condition is the whole point of D-114 — without it a
 * back-dated third-party stamp lands ahead of the platform's own foundation
 * migration — and it is what makes the watermark a core-tree fact a package
 * author can ignore (`contracts/migration-identity.md` §4).
 *
 * What does order this chain is the module graph: a stamp orders a module's own
 * migrations and nothing else.
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
