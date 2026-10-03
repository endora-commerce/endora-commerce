import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A module package on disk that ships every Page Builder renderer layer — the
 * fixture `check:block-renderers`' red proofs and its companion test both build
 * (`specs/141-module-block-renderers/`).
 *
 * One builder, two callers, in the idiom `bundle-pairing-fixture.ts`
 * established: two builders over one population are two answers waiting to
 * disagree. It writes the files a real package holds — `package.json`,
 * `tsconfig.build.json`, a manifest and the layers — so a proof enters at the
 * top of the analysis: the description that reads the package off disk, and
 * then the rule over what it read (issue #130).
 */

export const FIXTURE_MODULE_ID = 'crm';

/** The compliant package: every finding below is one edit away from it. */
export const COMPLIANT_FILES: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({
    name: '@acme/mod-crm',
    version: '1.0.0',
    type: 'module',
    endora: { type: 'module', id: FIXTURE_MODULE_ID },
    exports: {
      '.': './dist/manifest.js',
      './backend': './dist/backend/index.js',
      './admin': './dist/admin/index.js',
      './storefront': './dist/storefront/index.js',
      './email': './dist/email/index.js',
      './blocks.css': './blocks.css',
    },
  }),
  'tsconfig.build.json': JSON.stringify({
    compilerOptions: { rootDir: './src', outDir: './dist' },
  }),
  'src/manifest.ts':
    'export const manifest = {\n' +
    "  id: 'crm',\n" +
    '  blocks: [\n' +
    "    { name: 'crm.Badge', contexts: ['cms', 'email'], fields: {} },\n" +
    "    { name: 'crm.Banner', contexts: ['cms'], fields: {} },\n" +
    '  ],\n' +
    '};\n',
  'src/storefront/index.ts':
    "'use client';\n" +
    "import type { StorefrontContributions } from '@endora-commerce/page-builder-core/contributions';\n" +
    "import { Badge } from './Badge.js';\n" +
    'export const contributions: StorefrontContributions = {\n' +
    "  blocks: { 'crm.Badge': { render: Badge } },\n" +
    '};\n',
  'src/storefront/Badge.tsx':
    "'use client';\n" +
    "import { sanitizeRichHtml } from '@endora-commerce/cms-components';\n" +
    'export function Badge(props: { html?: string }) {\n' +
    "  return <span className=\"crm-badge\" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(props.html ?? '') }} />;\n" +
    '}\n',
  'src/email/index.ts':
    "import { escapeHtml } from '@endora-commerce/email-components/render/escape-html';\n" +
    'export const emailBlocks = {\n' +
    "  'crm.Badge': { html: (props: { text?: string }) => `<tr><td>${escapeHtml(String(props.text))}</td></tr>` },\n" +
    '};\n',
  'src/admin/index.ts':
    'export const contributions = {\n' +
    '  blocks: [\n' +
    "    { name: 'crm.Badge', context: 'cms', component: () => import('./badge-editor.js') },\n" +
    "    { name: 'crm.Badge', context: 'email', component: () => import('./badge-email.js') },\n" +
    '  ],\n' +
    '};\n',
  'blocks.css':
    '.crm-badge { color: var(--brand-600, #2563eb); }\n' +
    '@media (max-width: 640px) { .crm-badge { font-size: 13px; } }\n',
};

export interface BlockRendererFixture {
  readonly dir: string;
  readonly cleanup: () => void;
}

/**
 * Write the compliant package with `overrides` applied. A `null` value removes
 * the file, which is how a missing stylesheet and a withheld manifest are built.
 */
export function createBlockRendererFixture(
  overrides: Readonly<Record<string, string | null>> = {},
): BlockRendererFixture {
  const dir = mkdtempSync(join(tmpdir(), 'block-renderers-'));
  const files: Record<string, string | null> = { ...COMPLIANT_FILES, ...overrides };
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The compliant `package.json`, with its `exports` map edited. */
export function manifestWithExports(
  edit: (exportsMap: Record<string, string>) => void,
): string {
  const manifest = JSON.parse(COMPLIANT_FILES['package.json'] as string) as {
    exports: Record<string, string>;
  };
  edit(manifest.exports);
  return JSON.stringify(manifest);
}
