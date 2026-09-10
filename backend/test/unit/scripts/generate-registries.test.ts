import { describe, expect, it } from 'vitest';

import {
  collectEntities,
  collectMigrations,
  coreSources,
  emitEntitiesRegistry,
  emitMigrationsRegistry,
  platformSubpathPublishing,
  type SourceTree,
} from '../../../scripts/generate-composer.js';
import type { BarrelParse } from '../../../scripts/lib/platform-surface.js';

/**
 * Red-first fixtures for the two registries `generate-composer.ts` emits
 * (feature 071, F2).
 *
 * `entities-registry` and `migrations-registry` were hand-maintained lists —
 * 219 imports and 130 entries a person kept in sync with the filesystem. The
 * failure mode of both is silence: an entity nobody added surfaces as an ORM
 * error somewhere unrelated, and a migration nobody registered simply does not
 * run, so `migration:pending` reports nothing pending and the first symptom is a
 * query against a table that was never created.
 *
 * A generator only moves that failure if it can go red. So the two collectors
 * take the tree as a map rather than reading the disk, and every way the tree
 * can be wrong is driven here on input the repository does not contain
 * (issue #113, `docs/docs/architecture/kernel.md` § *Writing a check that can go
 * red*). What the collectors must refuse is, in every case, something that would
 * otherwise be emitted as an empty list or a quietly shorter one.
 */

/**
 * The application's own sources, as the collectors take them.
 *
 * Since feature 080's T041a a `SourceTree` entry carries its **origin** as well
 * as its text, because a module may now live in a workspace package and the
 * specifier emitted for it is derived from that package's manifest rather than
 * from its path. `coreSources` is the generator's own constructor for the
 * application half, so these fixtures keep entering where a real walk enters.
 */
const tree = (entries: Record<string, string>): SourceTree => coreSources(entries);

const ENTITY_SOURCE = ['@Entity()', 'export class Post {}'].join('\n');

describe('collectEntities', () => {
  it('finds an entity by its decorator, not by the file suffix', () => {
    // The suffix is a convention nothing enforces. A walk scoped to
    // `*.entity.ts` reports a clean registry for an entity declared next door,
    // which is exactly the shape `check-entity-tenant-classification.ts` was
    // widened away from.
    const found = collectEntities(
      tree({
        'modules/blog/entities/post.entity.ts': ENTITY_SOURCE,
        'modules/blog/entities/tag.ts': '@Entity({ tableName: "tags" })\nexport class Tag {}',
      }),
    );
    expect(found.map((entity) => entity.className)).toEqual(['Post', 'Tag']);
  });

  it('orders by file path, so the emitted registry is a function of the tree', () => {
    const found = collectEntities(
      tree({
        'modules/blog/entities/zebra.entity.ts': '@Entity()\nexport class Zebra {}',
        'kernel/audit/audit-log-entry.entity.ts': '@Entity()\nexport class AuditLogEntry {}',
      }),
    );
    expect(found.map((entity) => entity.file)).toEqual([
      'kernel/audit/audit-log-entry.entity.ts',
      'modules/blog/entities/zebra.entity.ts',
    ]);
  });

  it('refuses a `.entity.ts` file that declares no entity', () => {
    // Either the decorator was dropped or the file is misnamed. Both are worth a
    // sentence; neither is worth an entity silently leaving the ORM metadata.
    expect(() =>
      collectEntities(tree({ 'modules/blog/entities/post.entity.ts': 'export class Post {}' })),
    ).toThrow(/declares no @Entity/);
  });

  it('refuses a decorated class it cannot name', () => {
    expect(() =>
      collectEntities(
        tree({ 'modules/blog/entities/post.entity.ts': '@Entity()\nconst Post = class {};' }),
      ),
    ).toThrow(/could not be read/);
  });

  it('refuses two entities with the same class name', () => {
    expect(() =>
      collectEntities(
        tree({
          'modules/blog/entities/post.entity.ts': ENTITY_SOURCE,
          'modules/cms/entities/post.entity.ts': ENTITY_SOURCE,
        }),
      ),
    ).toThrow(/Post/);
  });

  it('refuses an entity under a deployment overlay', () => {
    // Overlay modules cannot ship migrations — the walk below is core-only by
    // construction — so an overlay entity would be ORM metadata for a table
    // nothing creates. Refusing it says so where the author is standing.
    expect(() =>
      collectEntities(tree({ 'apps/example/modules/example_overlay/entities/x.entity.ts': ENTITY_SOURCE })),
    ).toThrow(/overlay/i);
  });
});

const MIGRATION_SOURCE = 'export class Migration20260901T101112BlogWidenSlug extends Migration {}';

describe('collectMigrations', () => {
  it('derives the module id and the class name from the path and the filename', () => {
    const found = collectMigrations(
      tree({
        'modules/blog/migrations/20260901T101112_blog_widen_slug.ts': MIGRATION_SOURCE,
        'migrations/20260901T101113_core_thing.ts':
          'export class Migration20260901T101113CoreThing extends Migration {}',
      }),
    );
    expect(found).toEqual([
      {
        moduleId: 'core',
        className: 'Migration20260901T101113CoreThing',
        file: 'migrations/20260901T101113_core_thing.ts',
        owner: null,
      },
      {
        moduleId: 'blog',
        className: 'Migration20260901T101112BlogWidenSlug',
        file: 'modules/blog/migrations/20260901T101112_blog_widen_slug.ts',
        owner: null,
      },
    ]);
  });

  it('refuses a class name the file does not export', () => {
    // The class name is what `mikro_orm_migrations` persists. A generator that
    // emitted a name nobody exports would not compile; one that guessed a
    // different name would make every existing database re-run the migration.
    expect(() =>
      collectMigrations(
        tree({
          'modules/blog/migrations/20260901T101112_blog_widen_slug.ts':
            'export class Migration20260901T101112BlogWidenSlugs extends Migration {}',
        }),
      ),
    ).toThrow(/Migration20260901T101112BlogWidenSlug\b/);
  });

  it('refuses an unrecognized file in a migrations directory', () => {
    expect(() =>
      collectMigrations(tree({ 'modules/blog/migrations/helper.ts': 'export const a = 1;' })),
    ).toThrow(/helper\.ts/);
  });

  /**
   * The §4 helper exemption, with the allow-list injected.
   *
   * It used to be asserted against whichever real file happened to be on the
   * list, which made the proof a hostage of the tree: `quote_requests` became a
   * module package (feature 080, T040b), its key changed origin, and this test
   * went red for a reason that had nothing to do with the mechanism. The
   * allow-list is a parameter now — issue #130's "the fixture enters at the top
   * of the analysis" — so the proof is about the lookup and stays true whichever
   * files are exempt today.
   */
  it('skips a helper the naming contract allows there, in the application tree', () => {
    const allowed = new Set(['modules/quote_requests/migrations/status-mapping.ts']);
    expect(
      collectMigrations(
        tree({ 'modules/quote_requests/migrations/status-mapping.ts': 'export const map = {};' }),
        allowed,
      ),
    ).toEqual([]);
  });

  it('refuses that same helper when the allow-list does not name it', () => {
    expect(() =>
      collectMigrations(
        tree({ 'modules/quote_requests/migrations/status-mapping.ts': 'export const map = {};' }),
        new Set(),
      ),
    ).toThrow(/status-mapping\.ts/);
  });

  it('refuses two migrations with the same class name', () => {
    expect(() =>
      collectMigrations(
        tree({
          'modules/blog/migrations/20260901T101112_blog_widen_slug.ts': MIGRATION_SOURCE,
          'modules/cms/migrations/20260901T101112_blog_widen_slug.ts': MIGRATION_SOURCE,
        }),
      ),
    ).toThrow(/Migration20260901T101112BlogWidenSlug/);
  });

  it('refuses a migration under a deployment overlay', () => {
    // An overlay migration is never executed today: the registry is core-only,
    // and making it otherwise is a feature rather than a side effect of
    // generating the list. Until then the silence is the defect, so it is loud.
    expect(() =>
      collectMigrations(
        tree({
          'apps/example/modules/example_overlay/migrations/20260901T101112_example_overlay_init.ts':
            'export class Migration20260901T101112ExampleOverlayInit extends Migration {}',
        }),
      ),
    ).toThrow(/overlay/i);
  });
});

describe('the generator does not read its own output', () => {
  // Found the hard way: the emitted entity registry described what it had
  // scanned for, quoting the decorator, and the walk that produced it then
  // matched the quotation on the next run — so `composer:generate` succeeded
  // once and failed the second time. A generated artefact is output, not input,
  // and the render functions must be able to say what they do without a walk
  // reacting to the sentence.
  it('emits a re-readable entity registry', () => {
    const content = emitEntitiesRegistry([
      { className: 'Post', file: 'modules/blog/entities/post.entity.ts', owner: null },
    ]);
    expect(() =>
      collectEntities(tree({ 'db/entities-registry.generated.ts': content })),
    ).not.toThrow();
  });

  it('emits a re-readable migration registry', () => {
    const content = emitMigrationsRegistry([
      {
        moduleId: 'blog',
        className: 'Migration20260901T101112BlogWidenSlug',
        file: 'modules/blog/migrations/20260901T101112_blog_widen_slug.ts',
        owner: null,
      },
    ]);
    expect(collectMigrations(tree({ 'db/migrations-registry.generated.ts': content }))).toEqual([]);
  });
});

describe('the emitted registries', () => {
  it('imports every entity exactly once and lists it', () => {
    const content = emitEntitiesRegistry([
      { className: 'Post', file: 'modules/blog/entities/post.entity.ts', owner: null },
    ]);
    expect(content).toContain(
      "import { Post } from '../modules/blog/entities/post.entity.js';",
    );
    expect(content).toContain('export const ALL_ENTITIES = [');
    expect(content).toContain('  Post,');
  });

  /**
   * `specs/110-instance-repository/` T119c.
   *
   * This assertion read `"import { AuditLogEntry } from
   * '../kernel/audit/audit-log-entry.entity.js';"` and it was the thing holding
   * five re-export shims open: the generator spelled all six platform entity
   * classes relatively because one of them — `ModuleRegistration` — had no
   * address at all, and a generator cannot emit five of six imports one way and
   * the sixth another for no stated reason.
   *
   * The two lines below are the whole of the change, and they are two rather
   * than one on purpose: the subpath is the one that publishes the **class**,
   * not the one whose `exports` target covers the file. `./kernel` covers
   * `dist/kernel/**`, `module-registration.entity.js` included, so a
   * file-covering derivation would name `@endora-commerce/platform/kernel` for a
   * class that barrel does not carry — a specifier that resolves to a module
   * with no such export.
   */
  it("names a platform entity by the subpath that publishes its class", () => {
    const content = emitEntitiesRegistry([
      { className: 'AuditLogEntry', file: 'kernel/audit/audit-log-entry.entity.ts', owner: null },
      {
        className: 'ModuleRegistration',
        file: 'kernel/lifecycle/module-registration.entity.ts',
        owner: null,
      },
    ]);
    expect(content).toContain(
      "import { AuditLogEntry } from '@endora-commerce/platform/kernel';",
    );
    expect(content).toContain(
      "import { ModuleRegistration } from '@endora-commerce/platform/composition';",
    );
    expect(content).not.toContain('../kernel/');
  });

  /**
   * The refusal, and the reason it is a refusal rather than a fallback: a
   * relative specifier into the platform resolves in this checkout and in no
   * client's, so falling back would emit an artefact that works here and breaks
   * on the machine nobody can debug. The fixture names a file that really is the
   * platform's and a class no barrel carries, which is exactly the state
   * `ModuleRegistration` was in before this task.
   */
  it('refuses a platform entity no declared subpath publishes', () => {
    expect(() =>
      emitEntitiesRegistry([
        {
          className: 'NotOnAnyBarrel',
          file: 'kernel/lifecycle/module-registration.entity.ts',
          owner: null,
        },
      ]),
    ).toThrow(/no subpath the platform declares publishes 'NotOnAnyBarrel'/);
  });

  /**
   * R3.1a — a symbol is on one barrel and never two, so a generated artefact has
   * no basis to pick. Pure over parsed barrels, which is what lets the fixture
   * enter where a real run enters: the impure half only reads the platform's
   * `exports` map and its barrels off disk.
   */
  it('refuses a symbol two declared subpaths publish out of one file', () => {
    const barrel = (subpath: string): [string, BarrelParse] => [
      subpath,
      {
        barrel: `${subpath}/index.ts`,
        published: [{ name: 'Twice', target: 'kernel/twice.entity.ts' }],
        unreadable: [],
      },
    ];
    expect(() =>
      platformSubpathPublishing(
        new Map([barrel('kernel'), barrel('composition')]),
        'Twice',
        'kernel/twice.entity.ts',
      ),
    ).toThrow(/more than one declared subpath/);
  });

  it('answers null for a symbol no barrel publishes out of that file', () => {
    // The discrimination the refusal above rests on: *this* file, not merely
    // *this* name. A barrel carrying `Setting` out of `settings/setting.entity.ts`
    // says nothing about a `Setting` declared somewhere else.
    expect(
      platformSubpathPublishing(
        new Map([
          [
            'kernel',
            {
              barrel: 'kernel/index.ts',
              published: [{ name: 'Setting', target: 'kernel/settings/setting.entity.ts' }],
              unreadable: [],
            },
          ],
        ]),
        'Setting',
        'kernel/elsewhere/setting.entity.ts',
      ),
    ).toBeNull();
  });

  it('emits a migration entry carrying the module that owns the file', () => {
    const content = emitMigrationsRegistry([
      {
        moduleId: 'core',
        className: 'Migration20260901T101113CoreThing',
        file: 'migrations/20260901T101113_core_thing.ts',
        owner: null,
      },
      {
        moduleId: 'blog',
        className: 'Migration20260901T101112BlogWidenSlug',
        file: 'modules/blog/migrations/20260901T101112_blog_widen_slug.ts',
        owner: null,
      },
    ]);
    // `specs/110-instance-repository/` T116: a `core` migration is the
    // platform's own and is named through the subpath that publishes it, not
    // through a relative path — the twelve moved out of the application and no
    // shim was left behind for them.
    expect(content).toContain(
      "import { Migration20260901T101113CoreThing } from '@endora-commerce/platform/migrations';",
    );
    expect(content).toContain("migration('blog', Migration20260901T101112BlogWidenSlug),");
    expect(content).toContain('export const MIGRATION_REGISTRY: readonly MigrationRegistryEntry[] = [');
  });

  it('says in the emitted file that declaration order means nothing', () => {
    // The one thing a reader of a generated migration list must not conclude.
    // Execution order is `migration-order.ts`' job, from the timestamps and the
    // manifest dependency graph; a generator that looked like a second source of
    // ordering would invite someone to "fix" an ordering surprise here.
    const content = emitMigrationsRegistry([
      {
        moduleId: 'blog',
        className: 'Migration20260901T101112BlogWidenSlug',
        file: 'modules/blog/migrations/20260901T101112_blog_widen_slug.ts',
        owner: null,
      },
    ]);
    expect(content).toMatch(/order/i);
    expect(content).toContain('migration-order.ts');
  });
});
