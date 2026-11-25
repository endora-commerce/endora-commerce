import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { overlayModuleIdsUnder } from './overlay-runtime.js';
import {
  discoverOverlaySchema,
  exitOnRefusal,
  OverlaySchemaError,
  overlaySchemaContributionsUnder,
} from './overlay-schema.js';

/**
 * An overlay module's schema, read the way an installed package's is
 * (`specs/190-overlay-full-modules/` FR-030 – FR-032, contract
 * `overlay-schema-discovery.md` §1, #1850).
 *
 * The fixtures are real directories shaped like a deployment's compiled overlay
 * tree — `.js` units, the entity decorator applied as the call a compiler emits —
 * and are entered where the ORM configuration enters them, so the walk, the
 * imports and every refusal are the ones a boot runs. The decorator is imported
 * by absolute URL: a temporary directory has no `node_modules` to resolve it
 * from, and the metadata storage it writes must be the one this process reads.
 */
const roots: string[] = [];

const DECORATORS = pathToFileURL(
  createRequire(import.meta.url).resolve('@mikro-orm/decorators/legacy'),
).href;

function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'overlay-schema-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content, 'utf8');
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const manifest = (id: string, extra = ''): string =>
  `export const manifest = { id: '${id}', name: '${id}', version: '1.2.0'${extra} };\n`;

/** An entity class in the compiled shape, under a table name unique to the fixture. */
const entitySource = (className: string, table: string): string =>
  `import { Entity } from ${JSON.stringify(DECORATORS)};\n` +
  `export class ${className} {}\n` +
  `Entity({ tableName: '${table}' })(${className});\n`;

const BACKEND_WITH_ENTITIES =
  "import { NoticeBoard } from './entities/notice-board.js';\n" +
  'export const entities = [NoticeBoard];\n' +
  'export function registerModule() {}\n';

const MIGRATION = 'export class Migration20260101T000000NoticeInit { async up() {} }\n';

/** The modules root of deployment `shop` under a deployment root. */
const MODULES = 'apps/shop/modules';

describe('overlaySchemaContributionsUnder — what an overlay module contributes', () => {
  it('reads the `entities` export, the migrations file by file, and the manifest', async () => {
    const root = tree({
      [`${MODULES}/notice/manifest.js`]: manifest(
        'notice',
        ", dependencies: ['organizations'], activation: { nonDeactivatable: true }",
      ),
      [`${MODULES}/notice/backend.js`]: BACKEND_WITH_ENTITIES,
      [`${MODULES}/notice/entities/notice-board.js`]: entitySource('NoticeBoard', 'fx_notice_boards_a'),
      [`${MODULES}/notice/migrations/20260101T000000_notice_init.js`]: MIGRATION,
      [`${MODULES}/notice/migrations/20260102T000000_notice_widen.js`]:
        'export class Migration20260102T000000NoticeWiden { async up() {} }\n',
      // None of these is a runtime unit: a declaration file, a source map, a test.
      [`${MODULES}/notice/migrations/20260101T000000_notice_init.d.ts`]: 'export {};\n',
      [`${MODULES}/notice/migrations/20260101T000000_notice_init.js.map`]: '{}',
      [`${MODULES}/notice/migrations/notice-init.test.js`]: 'export class Anything {}\n',
    });
    const modules = join(root, MODULES);

    const [notice, ...rest] = await overlaySchemaContributionsUnder(modules, ['notice']);
    expect(rest).toEqual([]);
    expect(notice!.id).toBe('notice');
    expect(notice!.source).toBe('overlay apps/shop/modules/notice');
    expect(notice!.version).toBe('1.2.0');
    expect(notice!.dependencies).toEqual(['organizations']);
    expect(notice!.nonDeactivatable).toBe(true);
    expect(notice!.migrationsDirectory).toBe(join(modules, 'notice', 'migrations'));
    expect(notice!.entities.map((cls) => cls.name)).toEqual(['NoticeBoard']);
    expect(notice!.migrations.map((entry) => [entry.moduleId, entry.cls.name, entry.origin])).toEqual([
      ['notice', 'Migration20260101T000000NoticeInit', 'overlay'],
      ['notice', 'Migration20260102T000000NoticeWiden', 'overlay'],
    ]);
    expect(notice!.schemaExtensions).toEqual([]);
  });

  it('an overlay module with no schema contributes empty lists, not an absence', async () => {
    const root = tree({
      [`${MODULES}/plain/manifest.js`]: manifest('plain'),
      [`${MODULES}/plain/backend.js`]: 'export function registerModule() {}\n',
    });
    const [plain] = await overlaySchemaContributionsUnder(join(root, MODULES), ['plain']);
    expect(plain).toMatchObject({
      id: 'plain',
      entities: [],
      migrations: [],
      migrationsDirectory: null,
      dependencies: [],
      nonDeactivatable: false,
    });
  });

  it('a bare root is the empty answer', async () => {
    await expect(overlaySchemaContributionsUnder(null, [])).resolves.toEqual([]);
  });

  it('refuses `entities` that is not an array (entities-not-array)', async () => {
    const root = tree({
      [`${MODULES}/notice/manifest.js`]: manifest('notice'),
      [`${MODULES}/notice/backend.js`]: 'export const entities = {};\nexport function registerModule() {}\n',
    });
    const refused = await overlaySchemaContributionsUnder(join(root, MODULES), ['notice']).catch(
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(OverlaySchemaError);
    expect((refused as OverlaySchemaError).verdict).toBe('entities-not-array');
    expect((refused as Error).message).toContain('overlay apps/shop/modules/notice');
  });

  it('refuses an `entities` entry that is not a class (entity-not-class)', async () => {
    const root = tree({
      [`${MODULES}/notice/manifest.js`]: manifest('notice'),
      [`${MODULES}/notice/backend.js`]:
        "export const entities = ['NoticeBoard'];\nexport function registerModule() {}\n",
    });
    const refused = await overlaySchemaContributionsUnder(join(root, MODULES), ['notice']).catch(
      (error: unknown) => error,
    );
    expect((refused as OverlaySchemaError).verdict).toBe('entity-not-class');
    expect((refused as Error).message).toContain('entry 0');
  });

  describe('migration-file-shape', () => {
    const refusalFor = async (file: string, content: string): Promise<OverlaySchemaError> => {
      const root = tree({
        [`${MODULES}/notice/manifest.js`]: manifest('notice'),
        [`${MODULES}/notice/migrations/${file}`]: content,
      });
      const refused = await overlaySchemaContributionsUnder(join(root, MODULES), ['notice']).catch(
        (error: unknown) => error,
      );
      expect(refused).toBeInstanceOf(OverlaySchemaError);
      expect((refused as OverlaySchemaError).verdict).toBe('migration-file-shape');
      expect((refused as Error).message).toContain(join(root, MODULES, 'notice', 'migrations', file));
      return refused as OverlaySchemaError;
    };

    it('refuses a file that exports no class', async () => {
      const refused = await refusalFor('20260101T000000_notice_init.js', 'export const up = 1;\n');
      expect(refused.message).toContain('exports no class');
    });

    it('refuses a file that exports two classes', async () => {
      const refused = await refusalFor('20260101T000000_notice_init.js', `${MIGRATION}export class Helper {}\n`);
      expect(refused.message).toContain('Helper, Migration20260101T000000NoticeInit');
    });

    it('refuses a class whose name is not the one the filename derives', async () => {
      const refused = await refusalFor(
        '20260101T000000_notice_init.js',
        'export class Migration20260101T000000NoticeStart { async up() {} }\n',
      );
      expect(refused.message).toContain('Migration20260101T000000NoticeInit');
      expect(refused.message).toContain('Migration20260101T000000NoticeStart');
    });

    it('refuses a unit not named like a migration — it would never run, and nothing would say so', async () => {
      const refused = await refusalFor('status-mapping.js', 'export class StatusMapping {}\n');
      expect(refused.message).toContain('<YYYYMMDDTHHmmss>_<module-segment>_<slug>');
    });
  });

  it('refuses an entity class under `entities/` that `entities` does not name (overlay-entity-unexported)', async () => {
    const root = tree({
      [`${MODULES}/notice/manifest.js`]: manifest('notice'),
      [`${MODULES}/notice/backend.js`]: BACKEND_WITH_ENTITIES,
      [`${MODULES}/notice/entities/notice-board.js`]: entitySource('NoticeBoard', 'fx_notice_boards_b'),
      [`${MODULES}/notice/entities/nested/notice-pin.js`]:
        entitySource('NoticePin', 'fx_notice_pins') + 'export const NOT_A_CLASS = 1;\nexport class Plain {}\n',
    });
    const refused = await overlaySchemaContributionsUnder(join(root, MODULES), ['notice']).catch(
      (error: unknown) => error,
    );
    expect((refused as OverlaySchemaError).verdict).toBe('overlay-entity-unexported');
    expect((refused as Error).message).toContain('NoticePin');
    expect((refused as Error).message).toContain(join('entities', 'nested', 'notice-pin.js'));
    // A plain class beside it carries no entity metadata and is the author's business.
    expect((refused as Error).message).not.toContain('Plain');
  });
});

describe('discoverOverlaySchema — the active deployment, or nothing', () => {
  const deploymentRoot = (): string =>
    tree({
      [`${MODULES}/notice/manifest.js`]: manifest('notice'),
      [`${MODULES}/notice/migrations/20260101T000000_notice_init.js`]: MIGRATION,
    });

  it('reads the selected deployment', async () => {
    const found = await discoverOverlaySchema(deploymentRoot(), { DEPLOYMENT: 'shop' });
    expect(found.map((contribution) => contribution.id)).toEqual(['notice']);
  });

  it('is empty with DEPLOYMENT unset, another deployment, or no deployment root', async () => {
    const root = deploymentRoot();
    await expect(discoverOverlaySchema(root, {})).resolves.toEqual([]);
    await expect(discoverOverlaySchema(root, { DEPLOYMENT: 'other' })).resolves.toEqual([]);
    await expect(discoverOverlaySchema(undefined, { DEPLOYMENT: 'shop' })).resolves.toEqual([]);
  });
});

describe('an overlay module that ships schema is no longer refused (FR-037)', () => {
  it('`overlayModuleIdsUnder` lists it', () => {
    const root = tree({
      'notice/manifest.js': manifest('notice'),
      'notice/migrations/20260101T000000_notice_init.js': MIGRATION,
      'notice/entities/notice-board.js': entitySource('NoticeBoard', 'fx_notice_boards_c'),
    });
    expect(overlayModuleIdsUnder(root, [])).toEqual(['notice']);
  });
});

describe('an entry point prints the refusal as a sentence, and a defect with its stack', () => {
  const exiting = (): { restore: () => void } => {
    const spy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${String(code)}`);
    });
    return { restore: () => spy.mockRestore() };
  };

  it('`exitOnRefusal` writes the message alone and exits 1', () => {
    const { restore } = exiting();
    const err: string[] = [];
    const refusal = new OverlaySchemaError('migration-file-shape', 'notice', '[overlay] a refusal');
    try {
      expect(() => exitOnRefusal(refusal, (text) => err.push(text))).toThrow('exit 1');
    } finally {
      restore();
    }
    expect(err).toEqual(['[overlay] a refusal\n']);
  });

  it('`exitOnRefusal` treats the layout and freshness refusals the same way (#1848)', async () => {
    const { OverlayLayoutError } = await import('./overlay-layout.js');
    const { OverlayBuildError } = await import('./overlay-freshness.js');
    for (const refusal of [
      new OverlayLayoutError('/r', [{ kind: 'package-in-disguise', file: '/r/a/package.json' }]),
      new OverlayBuildError([{ verdict: 'unbuilt', source: '/s/a/manifest.ts', emitted: null }], 'pnpm run build'),
    ]) {
      const { restore } = exiting();
      const err: string[] = [];
      try {
        expect(() => exitOnRefusal(refusal, (text) => err.push(text))).toThrow('exit 1');
      } finally {
        restore();
      }
      expect(err).toEqual([`${refusal.message}\n`]);
    }
  });

  it('`exitOnRefusal` throws anything else again, untouched', () => {
    const defect = new TypeError('cannot read properties of undefined');
    const err: string[] = [];
    expect(() => exitOnRefusal(defect, (text) => err.push(text))).toThrow(defect);
    expect(err).toEqual([]);
  });
});
