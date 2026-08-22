export class Migration20260821T000000FixtureSchemaOnlyInit {
  async up() {
    this.addSql('create table "fixture_schema_only_rows" ("id" uuid not null primary key);');
  }
}

export const migrations = [
  {
    name: 'Migration20260821T000000FixtureSchemaOnlyInit',
    class: Migration20260821T000000FixtureSchemaOnlyInit,
  },
];
