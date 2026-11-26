/**
 * The overlay type-check an instance is scaffolded with (issue #1847,
 * `specs/190-overlay-full-modules/` T001–T003, FR-010, FR-011,
 * `contracts/overlay-build.md` §1).
 *
 * Overlay code under `apps/` is loaded by Node's type stripping and, before
 * this, compiled and checked by nothing: an `enum` crashed the boot with
 * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` and a type error after an upgrade
 * appeared only at run time. The template now writes a program over `apps/`
 * with `erasableSyntaxOnly`, a `typecheck` script naming it, and a `setup` that
 * runs it before `migrate`.
 *
 * The last `describe` hands the **rendered** configuration to the TypeScript
 * compiler over a temporary instance tree, so the claim "an `enum` is reported"
 * is measured against the bytes a client receives rather than against a
 * string this file expects.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { planInstance, type PlanInput } from './template.js';

const SCOPE = '@endora-commerce/';
const APPS_CONFIG = 'backend/tsconfig.apps.json';

function planInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    name: 'acme-shop',
    deployment: 'acme-shop',
    scope: SCOPE,
    platformVersion: '1.2.3',
    enginesNode: '>=22.17.0',
    packageManager: 'pnpm@9.15.0',
    modules: [{ id: 'settings', packageName: `${SCOPE}mod-settings`, version: '0.4.5' }],
    adminShellVersion: null,
    adminKitVersion: null,
    adminRanges: new Map(),
    adminPeers: new Map(),
    cliVersion: '1.2.3',
    docsRanges: new Map(),
    declaredRanges: new Map([
      ['@mikro-orm/core', '^6'],
      ['fastify', '^5'],
      ['zod', '^4'],
      ['typescript', '^5.9.3'],
    ]),
    registry: null,
    npmrc: null,
    topology: 'single-host',
    declared: [],
    existingEnv: '',
    generated: new Map(),
    ...overrides,
  };
}

function fileOf(path: string, input: PlanInput = planInput()): { kind: string; content: string } {
  const file = planInstance(input).files.find((entry) => entry.path === path);
  expect(file, `${path} is not in the plan`).toBeDefined();
  return file!;
}

function scriptsOf(path: string, input: PlanInput = planInput()): Record<string, string> {
  return (JSON.parse(fileOf(path, input).content) as { scripts: Record<string, string> }).scripts;
}

interface AppsConfig {
  extends: string;
  compilerOptions: Record<string, unknown>;
  include: string[];
  exclude: string[];
}

describe('FR-010 — the template writes a type-check program over `apps/`', () => {
  it('extends the backend configuration and holds overlay code only, per the contract', () => {
    const config = JSON.parse(fileOf(APPS_CONFIG).content) as AppsConfig;

    expect(config.extends).toBe('./tsconfig.json');
    expect(config.compilerOptions).toEqual({
      rootDir: '../apps',
      outDir: 'dist/apps',
      erasableSyntaxOnly: true,
      noEmit: true,
    });
    // `apps/<deployment>/*.ts` too: `divergence.ts` and its generated twin are
    // read at composition, so they are overlay code as much as a module is.
    expect(config.include).toEqual(['../apps/*/modules/**/*.ts', '../apps/*/*.ts']);
    expect(config.exclude).toEqual(['../apps/*/modules/*/admin/**', '../apps/**/*.test.ts']);
  });

  it('is the client’s file, as the backend configuration it extends is', () => {
    expect(fileOf(APPS_CONFIG).kind).toBe(fileOf('backend/tsconfig.json').kind);
  });

  it('leaves the backend program’s own population alone — `apps/` is outside its `rootDir`', () => {
    const backend = JSON.parse(fileOf('backend/tsconfig.json').content) as AppsConfig;
    expect(backend.include).toEqual(['src']);
  });
});

describe('FR-011 — `typecheck` and `setup` run that program', () => {
  it('the backend member’s `typecheck` names both programs', () => {
    expect(scriptsOf('backend/package.json')['typecheck']).toBe(
      'tsc -p tsconfig.json --noEmit && tsc -p tsconfig.apps.json --noEmit',
    );
  });

  it('the root delegates `typecheck` to the backend member by directory', () => {
    expect(scriptsOf('package.json')['typecheck']).toBe('pnpm -C backend run typecheck');
  });

  it('`setup` runs it after `generate` and `build` and before `migrate`', () => {
    for (const input of [planInput(), planInput({ modules: [] })]) {
      const terms = scriptsOf('package.json', input)['setup']!.split(' && ');
      const typecheck = terms.indexOf('pnpm run typecheck');
      expect(typecheck, terms.join(' && ')).toBeGreaterThanOrEqual(0);
      // After `generate`: `divergence.generated.ts` is in the program.
      const generate = terms.indexOf('pnpm run generate');
      if (generate >= 0) expect(generate).toBeLessThan(typecheck);
      expect(terms.indexOf('pnpm run build')).toBeLessThan(typecheck);
      expect(typecheck).toBeLessThan(terms.indexOf('pnpm run migrate'));
    }
  });
});

/**
 * Diagnostics of the rendered `backend/tsconfig.apps.json` over a temporary
 * instance holding the rendered `backend/tsconfig.json` and `files`.
 */
function diagnosticsOver(files: Readonly<Record<string, string>>): readonly string[] {
  const root = mkdtempSync(join(tmpdir(), 'overlay-typecheck-'));
  try {
    const rendered = {
      'backend/tsconfig.json': fileOf('backend/tsconfig.json').content,
      [APPS_CONFIG]: fileOf(APPS_CONFIG).content,
      ...files,
    };
    for (const [path, content] of Object.entries(rendered)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const parsed = ts.getParsedCommandLineOfConfigFile(
      join(root, APPS_CONFIG),
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
    );
    expect(parsed, 'the rendered configuration did not parse').toBeDefined();
    expect(parsed!.errors).toEqual([]);
    const program = ts.createProgram({ rootNames: parsed!.fileNames, options: parsed!.options });
    return ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => `TS${String(diagnostic.code)} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('T003 — the rendered program refuses what type stripping cannot run', () => {
  const module = 'apps/acme-shop/modules/acme_overlay';
  const clean =
    "export type Tier = 'gold' | 'silver';\n" +
    "export function tierOf(points: number): Tier {\n  return points > 100 ? 'gold' : 'silver';\n}\n";

  it('a clean overlay module and deployment declaration pass', () => {
    expect(
      diagnosticsOver({
        [`${module}/backend.ts`]: clean,
        'apps/acme-shop/divergence.ts': 'export const divergence = { reasons: {} };\n',
      }),
    ).toEqual([]);
  });

  it.each([
    ['an `enum`', 'export enum Tier {\n  Gold,\n  Silver,\n}\n'],
    ['a `namespace` with a value', 'export namespace Tiers {\n  export const gold = 1;\n}\n'],
    [
      'a constructor parameter property',
      'export class Tier {\n  constructor(private readonly points: number) {}\n  get value(): number {\n    return this.points;\n  }\n}\n',
    ],
  ])('%s in an overlay module is reported under `erasableSyntaxOnly`', (_label, source) => {
    const found = diagnosticsOver({ [`${module}/backend.ts`]: source });
    expect(found.some((line) => line.startsWith('TS1294 ')), found.join('\n')).toBe(true);
  });

  it('an `enum` in the deployment’s own `divergence.ts` is reported too', () => {
    const found = diagnosticsOver({ 'apps/acme-shop/divergence.ts': 'export enum Seam {\n  A,\n}\n' });
    expect(found.some((line) => line.startsWith('TS1294 ')), found.join('\n')).toBe(true);
  });

  it('a type error in overlay code is reported — the check is a type-check, not a syntax lint', () => {
    const found = diagnosticsOver({
      [`${module}/backend.ts`]: 'export const points: number = "many";\n',
    });
    expect(found.some((line) => line.startsWith('TS2322 ')), found.join('\n')).toBe(true);
  });

  it('an admin layer and a test file are not in the program', () => {
    expect(
      diagnosticsOver({
        [`${module}/backend.ts`]: clean,
        [`${module}/admin/index.ts`]: 'export enum AdminOnly {\n  A,\n}\n',
        [`${module}/backend.test.ts`]: 'export enum TestOnly {\n  A,\n}\n',
      }),
    ).toEqual([]);
  });
});

/**
 * `specs/190-overlay-full-modules/` T018 (FR-012, FR-014, FR-016, contract `overlay-build.md`
 * §2–§3, #1848): the overlay code is compiled, so every compiled entry point composes from
 * `backend/dist` and hands the instance root as the source root the freshness guard reads;
 * `build` and `dev` run `endora build overlays`.
 */
describe('T018 — compiled entry points and the overlay build', () => {
  const plan = planInstance(planInput());
  const content = (path: string): string => plan.files.find((file) => file.path === path)!.content;
  const backend = JSON.parse(content('backend/package.json')) as { scripts: Record<string, string> };

  it('the API and the worker compose from backend/dist with the instance root as source', () => {
    for (const path of ['backend/src/index.ts', 'backend/src/worker.ts']) {
      const source = content(path);
      expect(source, path).toContain("const deploymentRoot = fileURLToPath(new URL('.', import.meta.url));");
      expect(source, path).toContain(
        "const deploymentSourceRoot = fileURLToPath(new URL('../..', import.meta.url));",
      );
      expect(source, path).toContain(
        'await composeApp({ deploymentRoot, deploymentSourceRoot }).catch(exitOnRefusal);',
      );
    }
  });

  it('the operator CLI and the module commands pass both roots', () => {
    expect(content('backend/src/cli.ts')).toContain(
      "deploymentRoot: fileURLToPath(new URL('.', import.meta.url)),",
    );
    expect(content('backend/src/cli.ts')).toContain(
      "deploymentSourceRoot: fileURLToPath(new URL('../..', import.meta.url)),",
    );
    const runtime = content('backend/src/module-commands/runtime.ts');
    expect(runtime).toContain("const deploymentRoot = fileURLToPath(new URL('..', import.meta.url));");
    expect(runtime).toContain(
      "const deploymentSourceRoot = fileURLToPath(new URL('../../..', import.meta.url));",
    );
    expect(runtime).toContain('runInstanceOperatorCommand({ deploymentRoot, deploymentSourceRoot,');
  });

  it('build compiles the backend, then the overlays; dev watches both', () => {
    expect(backend.scripts['build']).toBe('tsc -p tsconfig.json && endora build overlays');
    expect(backend.scripts['dev']).toMatch(
      /^tsc -p tsconfig\.json --watch & endora build overlays --watch & node .* --watch dist\/index\.js$/,
    );
  });

  it('declares the CLI even with nothing to generate, because build runs it', () => {
    const bare = planInstance(planInput({ modules: [], docsRanges: new Map() }));
    const root = JSON.parse(bare.files.find((file) => file.path === 'package.json')!.content) as {
      devDependencies: Record<string, string>;
    };
    expect(root.devDependencies[`${SCOPE}cli`]).toBeDefined();
  });

  it('the overlay project emits now (noEmit is the build flag, not the file)', () => {
    const config = JSON.parse(content(APPS_CONFIG)) as { compilerOptions: Record<string, unknown> };
    expect(config.compilerOptions['outDir']).toBe('dist/apps');
    expect(config.compilerOptions['rootDir']).toBe('../apps');
  });
});
