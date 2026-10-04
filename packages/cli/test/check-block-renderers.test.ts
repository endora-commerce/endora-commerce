/**
 * `check:block-renderers` in **package scope** — what `endora check` answers
 * about one module package's Page Builder renderers
 * (`specs/141-module-block-renderers/`, plan D11).
 *
 * The rule's own shapes — every import, every stylesheet offence — are held by
 * the repository host's companion test and by the inventory's red proofs. What
 * is new here is the **host**: the verdict a third-party author reads. One red
 * fixture per finding and one green, each a package on disk resolved through
 * the real `PackageLayout`, so the fixture enters where a run does.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { estateEntry } from '../src/check/estate.js';
import { PACKAGE_HOSTS } from '../src/check/hosts.js';
import { resolvePackageLayout } from '../src/check/layout.js';
import type { RuleResult } from '../src/check/run.js';

const ID = 'check:block-renderers';
const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

const EXPORTS: Readonly<Record<string, string>> = {
  '.': './dist/manifest.js',
  './backend': './dist/backend/index.js',
  './admin': './dist/admin/index.js',
  './storefront': './dist/storefront/index.js',
  './email': './dist/email/index.js',
  './blocks.css': './blocks.css',
};

function packageJson(exportsMap: Readonly<Record<string, string>> = EXPORTS): string {
  return JSON.stringify({
    name: '@acme/mod-crm',
    version: '1.0.0',
    type: 'module',
    endora: { type: 'module', id: 'crm' },
    exports: exportsMap,
  });
}

const GREEN: Readonly<Record<string, string>> = {
  'package.json': packageJson(),
  'tsconfig.build.json': JSON.stringify({ compilerOptions: { rootDir: './src', outDir: './dist' } }),
  'src/manifest.ts':
    "export const manifest = { id: 'crm', blocks: [{ name: 'crm.Badge', contexts: ['cms', 'email'], fields: {} }] };\n",
  'src/backend/index.ts': 'export function registerModule(): void {}\n',
  'src/storefront/index.ts':
    "'use client';\nimport { Badge } from './Badge.js';\n" +
    "export const contributions = { blocks: { 'crm.Badge': { render: Badge } } };\n",
  'src/storefront/Badge.tsx':
    "'use client';\nexport function Badge(props: { text?: string }) { return <span className=\"crm-badge\">{props.text}</span>; }\n",
  'src/email/index.ts': "export const emailBlocks = { 'crm.Badge': { html: () => '<tr><td>x</td></tr>' } };\n",
  'src/admin/index.ts':
    "export const contributions = { blocks: [{ name: 'crm.Badge', context: 'cms', component: () => import('./editor.js') }] };\n",
  'blocks.css': '.crm-badge { color: var(--brand-600, #2563eb); }\n',
};

function run(overrides: Readonly<Record<string, string | null>> = {}): RuleResult {
  const dir = mkdtempSync(join(tmpdir(), 'endora-check-blocks-'));
  scratch.push(dir);
  for (const [path, content] of Object.entries({ ...GREEN, ...overrides })) {
    if (content === null) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content, 'utf8');
  }
  return PACKAGE_HOSTS.get(ID)!(resolvePackageLayout(dir));
}

const kinds = (result: RuleResult): string[] =>
  result.findings.map((finding) => finding.message.split(':')[0]!).sort();

describe('the estate entry', () => {
  it('is a package-scope rule with a built host and no unevaluated signal', () => {
    const entry = estateEntry(ID)!;
    expect(entry.scope).toBe('package');
    expect(entry.host).toBe('built');
    expect(entry.partial ?? []).toEqual([]);
    expect(entry.tier).toBe('A');
    expect(PACKAGE_HOSTS.has(ID)).toBe(true);
  });
});

describe('a package whose renderers stay in their lane', () => {
  it('ran, found nothing, and says what it read', () => {
    const result = run();
    expect(result.verdict).toBe('ran');
    expect(result.findings).toEqual([]);
    expect(result.readSize).toMatchObject({
      prefix: '[block-renderers]',
      sites: 3,
      coverage: [{ source: 'package-exports', expected: 3, covered: 3 }],
    });
  });
});

describe('one red fixture per finding', () => {
  it('foreign-block-name', () => {
    const result = run({
      'src/storefront/index.ts':
        "import { Badge } from './Badge.js';\nexport const contributions = { blocks: { 'cms.Text': { render: Badge } } };\n",
    });
    expect(result.verdict).toBe('ran');
    expect(kinds(result)).toEqual(['foreign-block-name']);
    expect(result.findings[0]?.location).toBe('src/storefront/index.ts:2');
  });

  it('undeclared-block — a name the manifest does not declare, and a context it does not declare it for', () => {
    expect(
      kinds(run({ 'src/email/index.ts': "export const emailBlocks = { 'crm.Other': { html: () => '' } };\n" })),
    ).toEqual(['undeclared-block']);
    expect(
      kinds(
        run({
          'src/manifest.ts':
            "export const manifest = { id: 'crm', blocks: [{ name: 'crm.Badge', contexts: ['cms'], fields: {} }] };\n",
        }),
      ),
    ).toEqual(['undeclared-block']);
  });

  it('storefront-import', () => {
    expect(
      kinds(run({ 'src/storefront/data.ts': "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n" })),
    ).toEqual(['storefront-import']);
  });

  it('raw-html', () => {
    expect(
      kinds(
        run({
          'src/storefront/Badge.tsx':
            "'use client';\nexport function Badge(props: { html?: string }) { return <span dangerouslySetInnerHTML={{ __html: props.html }} />; }\n",
        }),
      ),
    ).toEqual(['raw-html']);
  });

  it('email-layer-import', () => {
    expect(
      kinds(run({ 'src/email/react.ts': "import { createElement } from 'react';\nexport const h = createElement;\n" })),
    ).toEqual(['email-layer-import']);
  });

  it('unscoped-stylesheet', () => {
    expect(kinds(run({ 'blocks.css': 'body { margin: 0; }\n' }))).toEqual(['unscoped-stylesheet']);
  });

  it('layer-without-subpath', () => {
    const { './storefront': _withheld, ...withoutStorefront } = EXPORTS;
    expect(kinds(run({ 'package.json': packageJson(withoutStorefront) }))).toEqual([
      'layer-without-subpath',
    ]);
  });
});

describe('the verdicts that are not findings', () => {
  it('a package that draws no block is not-applicable, and the line names the absent declaration', () => {
    const result = run({
      'package.json': packageJson({ '.': './dist/manifest.js', './backend': './dist/backend/index.js' }),
      'src/storefront/index.ts': null,
      'src/storefront/Badge.tsx': null,
      'src/email/index.ts': null,
      'src/admin/index.ts': null,
      'blocks.css': null,
    });
    expect(result.verdict).toBe('not-applicable');
    expect(result.explanation).toContain('storefront layer');
  });

  it('a declared stylesheet that is not there is unreadable, never clean', () => {
    const result = run({ 'blocks.css': null });
    expect(result.verdict).toBe('unreadable');
    expect(result.explanation).toContain('blocks.css');
  });

  it('a renderer claim over a manifest whose blocks cannot be read is unreadable, never clean', () => {
    const result = run({
      'src/manifest.ts': 'const blocks = load();\nexport const manifest = { id: "crm", blocks };\n',
    });
    expect(result.verdict).toBe('unreadable');
    expect(result.explanation).toContain('blocks');
  });

  it('an admin-only contribution is judged, with no layer expectation printed', () => {
    const result = run({
      'package.json': packageJson({
        '.': './dist/manifest.js',
        './backend': './dist/backend/index.js',
        './admin': './dist/admin/index.js',
      }),
      'src/storefront/index.ts': null,
      'src/storefront/Badge.tsx': null,
      'src/email/index.ts': null,
      'blocks.css': null,
      'src/admin/index.ts':
        "export const contributions = { blocks: [{ name: 'loyalty.Points', context: 'cms', component: () => import('./e.js') }] };\n",
    });
    expect(result.verdict).toBe('ran');
    expect(kinds(result)).toEqual(['foreign-block-name']);
    expect(result.readSize?.coverage).toBeUndefined();
  });
});
