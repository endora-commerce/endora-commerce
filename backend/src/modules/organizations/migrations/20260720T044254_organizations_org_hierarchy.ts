import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 056 — Hierarchical Organizations (tree + scope inheritance).
 *
 * Additive: turns the flat `organizations` table into a tree.
 *   - `parent_id uuid NULL REFERENCES organizations(id) ON DELETE RESTRICT`
 *     (self-reference; NULL ⇒ root; deletion of a parent with children is
 *     blocked at the DB level, backing the application precondition — R7).
 *   - `path text NOT NULL DEFAULT ''` — materialized ancestor-chain path
 *     `'/<rootId>/…/<thisId>/'`. A `text_pattern_ops` btree index answers
 *     descendant (`path LIKE :selfPath || '%'`) traversal in one indexed scan.
 *   - `credit_inheritance_mode varchar(20) NULL` — per-org platform-admin
 *     override (NULL ⇒ Settings global default).
 *
 * Backfill: every existing row becomes a root (`parent_id` stays NULL,
 * `path = '/' || id || '/'`), so `subtreeIds(org) = {org}` and all scoping /
 * inheritance collapse to today's flat behavior byte-for-byte (FR-001/FR-013).
 */
export class Migration20260720T044254OrganizationsOrgHierarchy extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "organizations" add column "parent_id" uuid null references "organizations" ("id") on delete restrict;',
    );
    this.addSql(`alter table "organizations" add column "path" text not null default '';`);
    this.addSql(
      'alter table "organizations" add column "credit_inheritance_mode" varchar(20) null;',
    );

    // Backfill every existing org as a root (parent_id stays NULL).
    this.addSql(`update "organizations" set "path" = '/' || "id" || '/';`);

    this.addSql(
      'create index "organizations_path_prefix_idx" on "organizations" ("path" text_pattern_ops);',
    );
    this.addSql(
      'create index "organizations_parent_id_idx" on "organizations" ("parent_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "organizations_path_prefix_idx";');
    this.addSql('drop index if exists "organizations_parent_id_idx";');
    this.addSql('alter table "organizations" drop column "credit_inheritance_mode";');
    this.addSql('alter table "organizations" drop column "path";');
    this.addSql('alter table "organizations" drop column "parent_id";');
  }
}
