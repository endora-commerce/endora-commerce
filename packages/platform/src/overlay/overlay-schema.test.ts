import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { overlayModuleIdsUnder, overlayModulesUnder } from './overlay-runtime.js';
import { assertOverlayModulesShipNoSchema, overlaySchemaFilesUnder } from './overlay-schema.js';

/**
 * An overlay module that ships schema stops the process that would have run
 * without it (D-106; `specs/conventions/overlay-modules.md`).
 *
 * The fixtures are real directories, entered where the platform enters them —
 * the overlay modules root a composition root or a `module:*` command resolves
 * — so the walk, the predicates and the seam are all the ones a boot runs.
 */
const roots: string[] = [];

function overlayRoot(files: Readonly<Record<string, string>>): string {
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

const MANIFEST = "export const manifest = { id: 'notice', version: '1.0.0' };\n";

describe('overlaySchemaFilesUnder', () => {
  it('finds nothing in a module that ships a manifest, an entry point and services', () => {
    const root = overlayRoot({
      'notice/manifest.js': MANIFEST,
      'notice/backend.js': 'export function registerModule() {}\n',
      'notice/services/notice-service.ts': 'export class NoticeService {}\n',
    });
    expect(overlaySchemaFilesUnder(root, ['notice'])).toEqual([]);
    expect(() => assertOverlayModulesShipNoSchema(root, ['notice'])).not.toThrow();
  });

  it('reports every file under a `migrations/` directory, at any depth', () => {
    const root = overlayRoot({
      'notice/manifest.js': MANIFEST,
      'notice/migrations/Migration20260101000000_notice_init.ts': 'export class M {}\n',
      'notice/src/migrations/index.ts': 'export {};\n',
    });
    expect(overlaySchemaFilesUnder(root, ['notice'])).toEqual([
      'notice/migrations/Migration20260101000000_notice_init.ts',
      'notice/src/migrations/index.ts',
    ]);
  });

  it('reports every file under an `entities/` directory, decorated or not', () => {
    const root = overlayRoot({
      'notice/manifest.js': MANIFEST,
      'notice/entities/notice.ts': 'export class Notice {}\n',
    });
    expect(overlaySchemaFilesUnder(root, ['notice'])).toEqual(['notice/entities/notice.ts']);
  });

  it('reports a source that declares an `@Entity()` class outside either directory', () => {
    const root = overlayRoot({
      'notice/manifest.js': MANIFEST,
      'notice/services/notice.ts': "@Entity({ tableName: 'notices' })\nexport class Notice {}\n",
      'notice/README.md': 'Mentions @Entity( in prose, which is not a source.\n',
    });
    expect(overlaySchemaFilesUnder(root, ['notice'])).toEqual(['notice/services/notice.ts']);
  });

  it('reads only the modules it was given, and never a `node_modules`', () => {
    const root = overlayRoot({
      'notice/manifest.js': MANIFEST,
      'notice/node_modules/dep/migrations/x.js': '',
      'other/migrations/x.ts': '',
    });
    expect(overlaySchemaFilesUnder(root, ['notice'])).toEqual([]);
  });
});

describe('the overlay seam refuses schema before anything is composed or resolved', () => {
  const withMigration = (): string =>
    overlayRoot({
      'notice/manifest.js': MANIFEST,
      'notice/migrations/Migration20260101000000_notice_init.ts': 'export class M {}\n',
    });

  it('names the file, what an overlay module contributes, and the remedy', () => {
    const root = withMigration();
    let message = '';
    try {
      assertOverlayModulesShipNoSchema(root, ['notice']);
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(join(root, 'notice/migrations/Migration20260101000000_notice_init.ts'));
    expect(message).toContain('contributes no schema');
    expect(message).toContain('module package');
  });

  it('`overlayModuleIdsUnder` — the derivation both seams share — throws', () => {
    expect(() => overlayModuleIdsUnder(withMigration(), [])).toThrow('contributes no schema');
  });

  it('`overlayModulesUnder` refuses on the manifest half and on the registration half', async () => {
    const modules = overlayModulesUnder(withMigration(), () => []);
    await expect(modules.manifests()).rejects.toThrow('contributes no schema');
    await expect(modules.entries()).rejects.toThrow('contributes no schema');
  });

  it('a root with no overlay is still the empty answer', async () => {
    const modules = overlayModulesUnder(null, () => []);
    expect(modules.ids()).toEqual([]);
    await expect(modules.manifests()).resolves.toEqual([]);
  });
});
