import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import {
  analysePackages,
  analyseThemes,
  cssExportsOf,
  darkScopeIndexOf,
  parseThemeBlocks,
  themeSpecifierOf,
} from '../scripts/theme-discovery.mjs';
import { defaultCodeOf, registryCodesOf } from '../scripts/check-themes.mjs';

/**
 * `check:themes` — feature `specs/102-storefront-theme-discovery/`.
 *
 * This is what replaced the third `describe` of `channel-theme.test.tsx`, which
 * walked `STOREFRONT_THEME_CODES` and grepped `app/globals.css` **as source
 * text**. Both halves of that had to go: the enum is gone because the platform
 * no longer holds a list (D-199), and reading the source was a false green of
 * exactly the shape `check:action-route-permissions`' `stale-artefact` finding
 * was measured taking three times — a third-party theme's block exists only
 * after the CSS build, so a source scan cannot see a bad `exports` map, a
 * dropped `@source` glob or a purge.
 *
 * Every finding below enters at the **top** of the analysis: a fixture registry
 * and a fixture stylesheet, never a value the check normally computes. A fixture
 * that enters below the defect cannot catch it.
 */

const CHECK = fileURLToPath(new URL('../scripts/check-themes.mjs', import.meta.url));

/** The twenty Tier-1 primitives, as a complete block's declarations. */
const PRIMITIVES = [
  '--brand-50', '--brand-100', '--brand-200', '--brand-600', '--brand-700', '--brand-900',
  '--bg', '--surface', '--surface-alt', '--line', '--line-strong',
  '--font-sans', '--font-mono',
  '--r-sm', '--r-md', '--r-lg', '--r-xl',
  '--shadow-sm', '--shadow-md', '--shadow-lg',
];

function block(code: string, names: readonly string[] = PRIMITIVES): string {
  return `:root[data-theme='${code}']{${names.map((n) => `${n}:#fff`).join(';')}}`;
}

function sheet(css: string): { path: string; css: string }[] {
  return [{ path: '/fixture/emitted.css', css }];
}

function findingsOf(result: { findings: { finding: string }[] }): string[] {
  return result.findings.map((f) => f.finding).sort();
}

describe('the emitted stylesheet is parsed as the browser gets it', () => {
  it("reads the minifier's unquoted attribute spelling, not only the source one", () => {
    // lightningcss rewrites `[data-theme='industria']` to `[data-theme=industria]`.
    // A parser that knew only the source spelling would find nothing in the one
    // artefact this check exists to read.
    const minified = ':root[data-theme=industria]{--brand-700:#1d4ed8;--r-md:8px}';
    const blocks = parseThemeBlocks(minified);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.code).toBe('industria');
    expect(blocks[0]!.declarations).toEqual(['--brand-700', '--r-md']);
  });

  it('reads both quoted spellings and a whitespace-padded selector', () => {
    const codes = parseThemeBlocks(
      `${block('a')}\n:root[data-theme="b"]{--bg:#fff}\n:root [ data-theme = 'c' ]{--bg:#fff}`,
    ).map((b) => b.code);
    expect(codes).toEqual(['a', 'b', 'c']);
  });

  it('finds the dark scope in both spellings, and reports -1 when there is none', () => {
    expect(darkScopeIndexOf(':root.is-dark{--bg:#000}')).toBe(0);
    expect(darkScopeIndexOf(':root .is-dark{--bg:#000}')).toBe(0);
    expect(darkScopeIndexOf(block('a'))).toBe(-1);
  });
});

describe("a theme package's CSS specifier comes off its own exports map", () => {
  it('follows a subpath map, a root string, a root subpath and a conditions object', () => {
    expect(themeSpecifierOf('@v/t', { './theme.css': './theme.css' })).toBe('@v/t/theme.css');
    expect(themeSpecifierOf('@v/t', './theme.css')).toBe('@v/t');
    expect(themeSpecifierOf('@v/t', { '.': './theme.css' })).toBe('@v/t');
    expect(themeSpecifierOf('@v/t', { './x.css': { default: './x.css' } })).toBe('@v/t/x.css');
    expect(themeSpecifierOf('@v/t', { style: './x.css' })).toBe('@v/t');
  });

  it('prefers the root export when a package publishes several stylesheets', () => {
    expect(
      themeSpecifierOf('@v/t', { './theme.min.css': './m.css', '.': './theme.css' }),
    ).toBe('@v/t');
  });

  it('answers null for a map that publishes no CSS, and ignores a wildcard subpath', () => {
    expect(themeSpecifierOf('@v/t', { '.': './index.js' })).toBeNull();
    expect(themeSpecifierOf('@v/t', undefined)).toBeNull();
    expect(cssExportsOf({ './css/*': './css/*.css' })).toEqual([]);
  });
});

describe('one red proof per finding, each entering at the top of the analysis', () => {
  it('undefined-theme — a registry code with no block in the emitted stylesheet', () => {
    const result = analyseThemes({
      registryCodes: ['industria', 'theme-x'],
      defaultCode: 'industria',
      stylesheets: sheet(block('industria')),
      packages: [{ name: '@v/t', declared: ['theme-x'], codes: ['theme-x'], specifier: '@v/t/x.css' }],
    });
    expect(findingsOf(result)).toEqual(['undefined-theme']);
    // It names the code and the package it came from — a theme author reading
    // this has to know which of their packages is the one that renders nothing.
    expect(result.findings[0]!.message).toContain('theme-x');
    expect(result.findings[0]!.message).toContain('@v/t');
  });

  it('partial-theme — a block setting fewer primitives than the default block', () => {
    const result = analyseThemes({
      registryCodes: ['industria', 'thin'],
      defaultCode: 'industria',
      stylesheets: sheet(block('industria') + block('thin', ['--brand-700', '--r-md'])),
      packages: [],
    });
    expect(findingsOf(result)).toEqual(['partial-theme']);
    expect(result.findings[0]!.message).toContain('--font-sans');
    expect(result.findings[0]!.message).toContain('2 of the 20');
  });

  it('partial-theme — the expected set is the default block, not a list in the check', () => {
    // An instance that adds a primitive to its own design system tells its theme
    // authors by failing, with the new name in the message. Nothing else moves.
    const result = analyseThemes({
      registryCodes: ['industria', 'nordic'],
      defaultCode: 'industria',
      stylesheets: sheet(block('industria', [...PRIMITIVES, '--ink-950']) + block('nordic')),
      packages: [],
    });
    expect(findingsOf(result)).toEqual(['partial-theme']);
    expect(result.findings[0]!.message).toContain('--ink-950');
  });

  it('unregistered-theme — a block the registry does not declare', () => {
    const result = analyseThemes({
      registryCodes: ['industria'],
      defaultCode: 'industria',
      stylesheets: sheet(block('industria') + block('smuggled')),
      packages: [],
    });
    expect(findingsOf(result)).toEqual(['unregistered-theme']);
    expect(result.findings[0]!.message).toContain('smuggled');
  });

  it('dark-scope-shadowed — a theme block that follows the dark rule', () => {
    const result = analyseThemes({
      registryCodes: ['industria', 'late'],
      defaultCode: 'industria',
      stylesheets: sheet(`${block('industria')}:root.is-dark{--bg:#000}${block('late')}`),
      packages: [],
    });
    expect(findingsOf(result)).toEqual(['dark-scope-shadowed']);
    expect(result.findings[0]!.message).toContain('late');
    // The same stylesheet with the block above the dark rule is clean, so the
    // proof is of the ordering and not of the block's existence.
    const ordered = analyseThemes({
      registryCodes: ['industria', 'late'],
      defaultCode: 'industria',
      stylesheets: sheet(`${block('industria')}${block('late')}:root.is-dark{--bg:#000}`),
      packages: [],
    });
    expect(ordered.findings).toEqual([]);
  });

  it('duplicate-theme — one code declared by two packages', () => {
    const findings = analysePackages([
      { name: '@a/t', declared: ['x'], codes: ['x'], specifier: '@a/t/t.css' },
      { name: '@b/t', declared: ['x'], codes: ['x'], specifier: '@b/t/t.css' },
    ]);
    expect(findings.map((f) => f.finding)).toEqual(['duplicate-theme']);
    expect(findings[0]!.message).toContain('@a/t');
    expect(findings[0]!.message).toContain('@b/t');
  });

  it('unresolvable-theme-css — a package declaring themes it publishes no CSS for', () => {
    const findings = analysePackages([
      { name: '@a/t', declared: ['x'], codes: ['x'], specifier: null },
    ]);
    expect(findings.map((f) => f.finding)).toEqual(['unresolvable-theme-css']);
    expect(findings[0]!.message).toContain('@a/t');
  });

  it('reports nothing over an instance whose registry and stylesheet agree', () => {
    const result = analyseThemes({
      registryCodes: ['industria', 'nordic', 'theme-x'],
      defaultCode: 'industria',
      stylesheets: sheet(
        `${block('industria')}${block('nordic')}${block('theme-x')}:root.is-dark{--bg:#000}`,
      ),
      packages: [
        { name: '@v/t', declared: ['theme-x'], codes: ['theme-x'], specifier: '@v/t/theme.css' },
      ],
    });
    expect(result.findings).toEqual([]);
  });
});

describe('the two artefact readers', () => {
  it('reads the codes out of the generated registry', () => {
    expect(registryCodesOf("export const INSTANCE_THEME_CODES = ['a', 'b'] as const;\n")).toEqual([
      'a',
      'b',
    ]);
    expect(registryCodesOf('export const INSTANCE_THEME_CODES = [] as const;\n')).toEqual([]);
    expect(registryCodesOf('nothing of the sort')).toEqual([]);
  });

  it('reads the instance default, with or without its type annotation', () => {
    expect(defaultCodeOf("export const DEFAULT_STOREFRONT_THEME_CODE = 'industria';")).toBe(
      'industria',
    );
    expect(
      defaultCodeOf(
        "export const DEFAULT_STOREFRONT_THEME_CODE: StorefrontThemeCode = 'nordic';",
      ),
    ).toBe('nordic');
    expect(defaultCodeOf('const OTHER = 1;')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The exit codes, over fixture instances. Each is a state of the check's
// *inputs*, so proving one means supplying them — `--root` is what makes that
// possible, and the green fixture is what proves the refusals discriminate.
// ---------------------------------------------------------------------------

const fixtures: string[] = [];

function instance(options: {
  registry?: string;
  instanceTs?: string;
  css?: string | null;
}): string {
  const root = mkdtempSync(join(tmpdir(), 'theme-fixture-'));
  fixtures.push(root);
  mkdirSync(join(root, 'lib', 'theme'), { recursive: true });
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  writeFileSync(
    join(root, 'lib', 'theme', 'themes.generated.ts'),
    options.registry ?? "export const INSTANCE_THEME_CODES = ['industria'] as const;\n",
  );
  writeFileSync(
    join(root, 'lib', 'theme', 'instance-themes.ts'),
    options.instanceTs ?? "export const DEFAULT_STOREFRONT_THEME_CODE = 'industria';\n",
  );
  if (options.css !== null) {
    mkdirSync(join(root, '.next', 'static', 'css'), { recursive: true });
    writeFileSync(join(root, '.next', 'static', 'css', 'a.css'), options.css ?? block('industria'));
  }
  return root;
}

function runCheck(root: string): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [CHECK, '--root', root], { encoding: 'utf8' });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

describe('a green result cannot mean "not looking"', () => {
  it('exits 0 and prints what it read over an instance that agrees', () => {
    const run = runCheck(instance({}));
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      '[theme-registry] read: files=3 themes=1 sources=registry:1/1,emitted-css:1/1',
    );
  });

  it('exits 2 on an empty registry', () => {
    const run = runCheck(
      instance({ registry: 'export const INSTANCE_THEME_CODES = [] as const;\n' }),
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('nothing was read');
    expect(run.stderr).toContain('declares no theme code');
  });

  it('exits 2 on an absent emitted stylesheet', () => {
    const run = runCheck(instance({ css: null }));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('no emitted stylesheet');
  });

  it('exits 2 on an emitted stylesheet with no [data-theme] block', () => {
    const run = runCheck(instance({ css: ':root{--bg:#fff}:root.is-dark{--bg:#000}' }));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('no [data-theme] block');
  });

  it('exits 2 when the instance default has no author, so partial-theme could not fire', () => {
    const run = runCheck(instance({ instanceTs: 'export const NOTHING = 1;\n' }));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('DEFAULT_STOREFRONT_THEME_CODE');
  });

  it('exits 1, not 2, on a finding — the tree is wrong, not the run', () => {
    const run = runCheck(
      instance({ registry: "export const INSTANCE_THEME_CODES = ['industria', 'gone'] as const;\n" }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('undefined-theme');
    // It still discloses what it read: a red run that says nothing about its
    // population is as unreadable as a green one.
    expect(run.stdout).toContain('[theme-registry] read:');
  });
});
