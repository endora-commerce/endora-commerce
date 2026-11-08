import { describe, expect, it, vi } from 'vitest';
import { parseSource, rememberRead, withSharedParses } from './parsed-source.js';
import { namedSpecifiers } from './specifiers.js';
import { declaredIndexes, declaredTableNames, sqlTableAccesses } from './sql-tables.js';

/**
 * The shared-parse scope (issue #910): one `ts.createSourceFile` per file for
 * the recognisers that read it, the same answers they give unshared, and
 * nothing retained outside the scope.
 *
 * The spy is on the compiler, not on {@link parseSource}, so a recogniser that
 * parses behind the helper's back is counted as well.
 */

const parses = vi.hoisted(() => [] as string[]);

vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import('typescript') }>();
  const real = actual.default;
  const createSourceFile: typeof real.createSourceFile = (...args) => {
    parses.push(args[0]);
    return real.createSourceFile(...args);
  };
  // `typescript`'s exports are getter-only, so the module is wrapped rather
  // than patched: every other member reads through to the real compiler.
  const wrapped = new Proxy(real, {
    get: (target, property, receiver) =>
      property === 'createSourceFile' ? createSourceFile : Reflect.get(target, property, receiver),
  });
  return { ...actual, default: wrapped };
});

const MIGRATION = 'modules/a/migrations/20260901T101010_a_widen.ts';
const MIGRATION_SOURCE = [
  "import { Migration } from '@mikro-orm/migrations';",
  'export class Migration20260901T101010AWiden extends Migration {',
  '  async up() {',
  '    this.addSql(`create table "a_things" ("id" uuid not null);`);',
  '    this.addSql(`create index "b_flag_index" on "b_things" ("flag");`);',
  '    this.addSql(`update "b_things" set "flag" = true where "id" is not null;`);',
  '    this.addSql(`drop index "c_old_index";`);',
  "    await this.getKnex()('c_things').insert({ id: 1 });",
  '  }',
  '}',
].join('\n');
const ENTITY = 'modules/a/entities/a-thing.entity.ts';
const ENTITY_SOURCE = "@Entity({ tableName: 'a_things' })\nexport class AThing {}\n@Entity()\nexport class AOther {}";
const INDEXES = new Map([['c_old_index', 'c_things']]);
const tableNameOf = (className: string): string => `${className.toLowerCase()}s`;

/** Every recogniser that reads a source, in the order a rule-major check asks. */
function everyRead(file: string, source: string) {
  return {
    specifiers: namedSpecifiers(source, file),
    accesses: sqlTableAccesses(source, file),
    ddl: sqlTableAccesses(source, file, { ddl: true, indexTables: INDEXES }),
    indexes: declaredIndexes(source, file),
    tables: declaredTableNames(source, file, tableNameOf),
  };
}

function parsesDuring(work: () => void): string[] {
  parses.length = 0;
  work();
  return [...parses];
}

describe('withSharedParses (issue #910)', () => {
  it('parses each file once for every recogniser that reads it, file-major or rule-major', () => {
    const files: ReadonlyArray<readonly [string, string]> = [
      [MIGRATION, MIGRATION_SOURCE],
      [ENTITY, ENTITY_SOURCE],
    ];
    // File-major: everything about one file, then the next.
    expect(
      parsesDuring(() => withSharedParses(() => files.forEach(([f, s]) => everyRead(f, s)))),
    ).toEqual([MIGRATION, ENTITY]);
    // Rule-major after one file-major visit: the later rules find remembered
    // answers, so the one tree the scope keeps moving on costs nothing.
    expect(
      parsesDuring(() =>
        withSharedParses(() => {
          files.forEach(([f, s]) => everyRead(f, s));
          for (const [f, s] of files) sqlTableAccesses(s, f, { ddl: true, indexTables: INDEXES });
          for (const [f, s] of files) namedSpecifiers(s, f);
          for (const [f, s] of files) declaredTableNames(s, f, tableNameOf);
        }),
      ),
    ).toEqual([MIGRATION, ENTITY]);
  });

  it('gives the answers each recogniser gives unshared', () => {
    const unshared = everyRead(MIGRATION, MIGRATION_SOURCE);
    // The fixture is not vacuous: every read found something.
    expect(unshared.specifiers.map((s) => s.text)).toEqual(['@mikro-orm/migrations']);
    expect(unshared.ddl.map((a) => [a.table, a.syntax])).toEqual(
      expect.arrayContaining([
        ['b_things', 'ddl'],
        ['c_things', 'ddl'],
        ['c_things', 'builder'],
      ]),
    );
    expect(unshared.indexes).toEqual([{ index: 'b_flag_index', table: 'b_things' }]);
    expect(unshared.tables).toEqual([{ table: 'a_things', source: 'migration' }]);

    expect(withSharedParses(() => everyRead(MIGRATION, MIGRATION_SOURCE))).toEqual(unshared);
    expect(withSharedParses(() => everyRead(ENTITY, ENTITY_SOURCE))).toEqual(
      everyRead(ENTITY, ENTITY_SOURCE),
    );
    // The naming strategy is applied after the remembered read, so a second
    // strategy asking the same file gets its own answer, not the first one's.
    withSharedParses(() => {
      expect(declaredTableNames(ENTITY_SOURCE, ENTITY, tableNameOf).map((t) => t.table)).toEqual([
        'a_things',
        'aothers',
      ]);
      expect(declaredTableNames(ENTITY_SOURCE, ENTITY, (name) => `t_${name}`).map((t) => t.table)).toEqual([
        'a_things',
        't_AOther',
      ]);
    });
  });

  it('re-reads a file whose text changed under the same name', () => {
    const changed = MIGRATION_SOURCE.replace('"b_things" set', '"d_things" set');
    const seen = parsesDuring(() =>
      withSharedParses(() => {
        expect(sqlTableAccesses(MIGRATION_SOURCE, MIGRATION).map((a) => a.table)).toContain(
          'b_things',
        );
        expect(sqlTableAccesses(changed, MIGRATION).map((a) => a.table)).toContain('d_things');
      }),
    );
    expect(seen).toEqual([MIGRATION, MIGRATION]);
  });

  it('retains nothing outside a scope, and releases on return and on throw', () => {
    expect(
      parsesDuring(() => {
        namedSpecifiers(MIGRATION_SOURCE, MIGRATION);
        namedSpecifiers(MIGRATION_SOURCE, MIGRATION);
      }),
    ).toEqual([MIGRATION, MIGRATION]);

    withSharedParses(() => parseSource(MIGRATION, MIGRATION_SOURCE));
    expect(parsesDuring(() => parseSource(MIGRATION, MIGRATION_SOURCE))).toEqual([MIGRATION]);

    expect(() =>
      withSharedParses(() => {
        rememberRead('test:value', MIGRATION, MIGRATION_SOURCE, () => 1);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    let derived = 0;
    rememberRead('test:value', MIGRATION, MIGRATION_SOURCE, () => (derived += 1));
    rememberRead('test:value', MIGRATION, MIGRATION_SOURCE, () => (derived += 1));
    expect(derived).toBe(2);
  });

  it('joins an enclosing scope and refuses asynchronous work', () => {
    expect(
      parsesDuring(() =>
        withSharedParses(() => {
          namedSpecifiers(MIGRATION_SOURCE, MIGRATION);
          withSharedParses(() => namedSpecifiers(MIGRATION_SOURCE, MIGRATION));
          namedSpecifiers(MIGRATION_SOURCE, MIGRATION);
        }),
      ),
    ).toEqual([MIGRATION]);
    expect(() => withSharedParses(() => Promise.resolve(1))).toThrow(/synchronous/);
  });

  it('copies a remembered list out, so a caller editing its answer cannot edit the next one', () => {
    withSharedParses(() => {
      namedSpecifiers(MIGRATION_SOURCE, MIGRATION).length = 0;
      expect(namedSpecifiers(MIGRATION_SOURCE, MIGRATION)).toHaveLength(1);
    });
  });
});
