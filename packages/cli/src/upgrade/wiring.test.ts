import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyWiringPlan, currentWiring, planWiring } from './wiring.js';
import { PREVIOUS_WIRING } from './wiring-renderings.js';

/**
 * `specs/190-overlay-full-modules/` T020 (FR-017, contract `overlay-build.md` §5): `endora
 * upgrade` brings an instance's wiring to the installed release's rendering — the compiled
 * entry points, `backend/tsconfig.apps.json`, the `build` / `dev` / `typecheck` / `setup`
 * scripts — and rewrites a file only while it is still what a release wrote. A file the
 * operator edited is reported, never overwritten.
 */

const NAME = 'acme-shop';
const SCOPE = '@endora-commerce/';
const SETUP_0112 = 'pnpm run generate && pnpm run build && pnpm run migrate && pnpm run module:install --all';
const NODE = 'node --env-file-if-exists=../.env';

function fill(text: string): string {
  return text.replaceAll('{{name}}', NAME).replaceAll('{{scope}}', SCOPE);
}

/** An instance exactly as 0.112.0 rendered it, as far as the upgrade reads it. */
function instance0112(): string {
  const root = mkdtempSync(join(tmpdir(), 'wiring-'));
  const write = (path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content, 'utf8');
  };
  write(
    'package.json',
    `${JSON.stringify(
      {
        name: NAME,
        private: true,
        scripts: { setup: SETUP_0112, build: 'pnpm -C backend run build' },
        devDependencies: { [`${SCOPE}platform`]: '0.112.0' },
      },
      null,
      2,
    )}\n`,
  );
  write(
    'backend/package.json',
    `${JSON.stringify(
      {
        name: `${NAME}-backend`,
        private: true,
        type: 'module',
        scripts: {
          dev: `tsc -p tsconfig.json --watch & ${NODE} --watch dist/index.js`,
          build: 'tsc -p tsconfig.json',
          start: `${NODE} dist/index.js`,
        },
      },
      null,
      2,
    )}\n`,
  );
  for (const [path, content] of Object.entries(PREVIOUS_WIRING.at(-1)!.files)) write(path, fill(content));
  return root;
}

const read = (root: string, path: string): string => readFileSync(join(root, path), 'utf8');
const scripts = (root: string, path: string): Record<string, string> =>
  (JSON.parse(read(root, path)) as { scripts: Record<string, string> }).scripts;

describe('planWiring / applyWiringPlan', () => {
  it('brings a 0.112.0 instance to the current rendering', () => {
    const root = instance0112();
    const plan = planWiring(root);
    expect(plan.edited).toEqual([]);
    applyWiringPlan(plan);

    const current = currentWiring({ name: NAME, scope: SCOPE });
    for (const [path, content] of Object.entries(current.files)) expect(read(root, path), path).toBe(content);
    expect(scripts(root, 'backend/package.json')).toMatchObject({
      build: 'tsc -p tsconfig.json && endora build overlays',
      typecheck: 'tsc -p tsconfig.json --noEmit && tsc -p tsconfig.apps.json --noEmit',
      start: `${NODE} dist/index.js`,
    });
    expect(scripts(root, 'backend/package.json')['dev']).toContain('endora build overlays --watch');
    expect(scripts(root, 'package.json')['typecheck']).toBe('pnpm -C backend run typecheck');
    expect(scripts(root, 'package.json')['setup']).toBe(
      'pnpm run generate && pnpm run build && pnpm run typecheck && pnpm run migrate && pnpm run module:install --all',
    );
  });

  it('is idempotent: a second plan over the result changes nothing', () => {
    const root = instance0112();
    applyWiringPlan(planWiring(root));
    const again = planWiring(root);
    expect(again.changes).toEqual([]);
    expect(again.edited).toEqual([]);
  });

  it('reports a wiring file the operator edited and leaves it as it is', () => {
    const root = instance0112();
    const edited = `${read(root, 'backend/src/index.ts')}// mine\n`;
    writeFileSync(join(root, 'backend/src/index.ts'), edited, 'utf8');
    writeFileSync(
      join(root, 'backend/package.json'),
      read(root, 'backend/package.json').replace('"tsc -p tsconfig.json"', '"tsc -p tsconfig.json && echo mine"'),
      'utf8',
    );

    const plan = planWiring(root);
    expect(plan.edited.map((entry) => entry.what)).toEqual([
      'backend/src/index.ts',
      'backend/package.json scripts.build',
    ]);
    applyWiringPlan(plan);
    expect(read(root, 'backend/src/index.ts')).toBe(edited);
    expect(scripts(root, 'backend/package.json')['build']).toBe('tsc -p tsconfig.json && echo mine');
    // Everything else still moves.
    expect(read(root, 'backend/src/worker.ts')).toContain('deploymentSourceRoot');
  });

  it('records a previous rendering that is not the current one', () => {
    const current = currentWiring({ name: '{{name}}', scope: '{{scope}}' });
    const newest = PREVIOUS_WIRING.at(-1)!;
    for (const path of Object.keys(newest.files)) {
      expect(newest.files[path], path).not.toBe(current.files[path]);
    }
  });
});
