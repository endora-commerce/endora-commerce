/**
 * `specs/193-admin-form-extensions/` WP-D review item 4 — an overlay's own render
 * site in an instance is **unbuilt TypeScript**, and `endora generate` runs as
 * compiled JavaScript under plain `node`. A host importing its form declaration
 * as `../forms.js` (the source file being `forms.ts`) must still resolve, or
 * every form an overlay lists and renders is reported unreadable.
 *
 * Spawned under plain `node` over the **built** CLI on purpose: vitest resolves
 * `.js` to `.ts` itself, so an in-process test would pass over the defect.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const BUILT = fileURLToPath(new URL('../dist/lib/admin-forms.js', import.meta.url));
const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

describe('an overlay render site, read by plain node (review item 4)', () => {
  it('resolves a form constant imported from the overlay’s own TypeScript', () => {
    const root = mkdtempSync(join(tmpdir(), 'admin-forms-overlay-'));
    scratch.push(root);
    const dir = join(root, 'apps', 'acme', 'modules', 'acme_x');
    write(join(dir, 'manifest.ts'), "export const manifest = { id: 'acme_x' };\n");
    write(
      join(dir, 'forms.ts'),
      "export const ACME_FORMS = { edit: { id: 'acme_thing.edit', fieldSet: 'acme_thing', mode: 'edit' as const, " +
        "sections: [{ key: 'main', keys: ['name'] }] } };\n",
    );
    write(join(dir, 'admin', 'index.tsx'), 'export const contributions = {};\n');
    write(
      join(dir, 'admin', 'Page.tsx'),
      "import { ACME_FORMS } from '../forms.js';\nexport const Page = () => <DeclaredFormProvider form={ACME_FORMS.edit} />;\n",
    );
    const script =
      `const { readOverlayDeployment } = await import(${JSON.stringify(pathToFileURL(BUILT).href)});\n` +
      `const read = await readOverlayDeployment(${JSON.stringify(join(root, 'apps'))}, 'acme', ${JSON.stringify(root)});\n` +
      'console.log(JSON.stringify({ renders: read.renders.map((r) => r.formId), unreadable: read.unreadable }));\n';
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout.trim().split('\n').at(-1)!)).toEqual({ renders: ['acme_thing.edit'], unreadable: [] });
  });
});
