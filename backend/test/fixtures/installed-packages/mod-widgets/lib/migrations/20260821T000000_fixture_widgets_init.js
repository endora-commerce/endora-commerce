// `fixture_widget_tags` is a join table this package owns and no entity of its
// declares — the case the owner map's second source exists for.
export class Migration20260821T000000FixtureWidgetsInit {
  async up() {
    this.addSql('create table "fixture_widgets" ("id" uuid not null primary key);');
    this.addSql(
      'create table "fixture_widget_tags" ("widget_id" uuid not null, "tag" text not null);',
    );
  }
}
