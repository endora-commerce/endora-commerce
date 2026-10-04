import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  acceptanceModulePackages,
  checkBlockRenderers,
  declaredBlocksOf,
  declaredLayerCount,
  describeBlockRendererPackage,
  stylesheetOffences,
  type BlockRendererFindingKind,
} from '../../../scripts/check-block-renderers.js';
import {
  createBlockRendererFixture,
  manifestWithExports,
} from '../../helpers/block-renderers-fixture.js';

/**
 * Companion test for `check-block-renderers`
 * (`specs/141-module-block-renderers/contracts/block-renderers.md` §2.3, §2.4,
 * R2.1, R3.1, R3.2, R4.1, R6.1).
 *
 * Every case builds a module package **on disk** and runs the description that
 * reads it and then the rule — the top of the analysis. The inventory's red
 * proofs call the same builder.
 */

const BACKEND = fileURLToPath(new URL('../../../', import.meta.url));

function kindsOver(overrides: Readonly<Record<string, string | null>>): BlockRendererFindingKind[] {
  const fixture = createBlockRendererFixture(overrides);
  try {
    const pkg = describeBlockRendererPackage(fixture.dir);
    if (pkg === null) throw new Error('the fixture was not read as a module package');
    return checkBlockRenderers([pkg]).findings.map((finding) => finding.kind);
  } finally {
    fixture.cleanup();
  }
}

describe('check-block-renderers — the control', () => {
  it('reads the compliant package and finds nothing', () => {
    const fixture = createBlockRendererFixture();
    try {
      const pkg = describeBlockRendererPackage(fixture.dir)!;
      const result = checkBlockRenderers([pkg]);
      expect(result.findings).toEqual([]);
      // It was read, not skipped: three layers, four claims, and the manifest.
      expect(declaredLayerCount(pkg)).toBe(3);
      expect(result.layersRead).toBe(3);
      expect(result.claims).toBe(4);
      expect(pkg.manifest?.path.endsWith(join('src', 'manifest.ts'))).toBe(true);
      expect(pkg.filesRead.length).toBeGreaterThanOrEqual(7);
    } finally {
      fixture.cleanup();
    }
  });

  it('answers null for a directory that is not a module package', () => {
    const fixture = createBlockRendererFixture({
      'package.json': JSON.stringify({ name: 'not-a-module', exports: {} }),
    });
    try {
      expect(describeBlockRendererPackage(fixture.dir)).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });
});

describe('check-block-renderers — what it refuses', () => {
  it('a storefront renderer keyed by a block another module owns', () => {
    expect(
      kindsOver({
        'src/storefront/index.ts':
          "import { Badge } from './Badge.js';\n" +
          "export const contributions = { blocks: { 'cms.Text': { render: Badge } } };\n",
      }),
    ).toEqual(['foreign-block-name']);
  });

  it('an e-mail renderer keyed by a first-party block', () => {
    expect(
      kindsOver({
        'src/email/index.ts':
          "export const emailBlocks = { 'transactional_emails.EmailText': { html: () => '' } };\n",
      }),
    ).toEqual(['foreign-block-name']);
  });

  it('a renderer for a block the manifest does not declare', () => {
    expect(
      kindsOver({
        'src/storefront/index.ts':
          "import { Badge } from './Badge.js';\n" +
          "export const contributions = { blocks: { 'crm.Missing': { render: Badge } } };\n",
      }),
    ).toEqual(['undeclared-block']);
  });

  it('a renderer for a context the manifest does not declare the block for', () => {
    // `crm.Banner` is declared for `cms` only.
    expect(
      kindsOver({
        'src/email/index.ts': "export const emailBlocks = { 'crm.Banner': { html: () => '' } };\n",
      }),
    ).toEqual(['undeclared-block']);
    expect(
      kindsOver({
        'src/admin/index.ts':
          'export const contributions = { blocks: [\n' +
          "  { name: 'crm.Banner', context: 'email', component: () => import('./x.js') },\n" +
          '] };\n',
      }),
    ).toEqual(['undeclared-block']);
  });

  it.each([
    ["import { readFileSync } from 'node:fs';", 'a Node built-in'],
    ["import 'server-only';", 'server-only'],
    ["import Link from 'next/link';", 'next/*'],
    ["import { lazyPort } from '@endora-commerce/platform/kernel';", 'the platform'],
    ["import { Button } from '@endora-commerce/admin-kit/ui';", 'the admin kit'],
    ["import { x } from '@acme/mod-loyalty/storefront';", 'another module'],
    ["import { renderToString } from 'react-dom/server';", 'react-dom/server'],
    ["import { helper } from '../backend/helper.js';", "the package's own backend"],
    ["const lazy = () => import('node:path');", 'a dynamic import'],
  ])('a storefront layer importing %s (%s)', (line) => {
    expect(
      kindsOver({
        'src/storefront/extra.ts': `${line}\nexport const extra = 1;\n`,
      }),
    ).toEqual(['storefront-import']);
  });

  it.each([
    ['{{ __html: props.html }}', 'the prop itself'],
    ['{{ __html: String(props.html) }}', 'another call'],
    ['{html}', 'an object built elsewhere'],
  ])('raw HTML injected as %s (%s)', (value) => {
    expect(
      kindsOver({
        'src/storefront/Badge.tsx':
          "'use client';\n" +
          'const html = { __html: "x" };\n' +
          'export function Badge(props: { html?: string }) {\n' +
          `  return <span dangerouslySetInnerHTML=${value} />;\n` +
          '}\n',
      }),
    ).toEqual(['raw-html']);
  });

  it('raw HTML in an emitted layer, where JSX is already a call', () => {
    expect(
      kindsOver({
        'src/storefront/Badge.tsx':
          "'use client';\n" +
          "import { jsx } from 'react/jsx-runtime';\n" +
          'export function Badge(props: { html?: string }) {\n' +
          "  return jsx('span', { dangerouslySetInnerHTML: { __html: props.html } });\n" +
          '}\n',
      }),
    ).toEqual(['raw-html']);
  });

  it.each([
    ["import { createElement } from 'react';", 'React'],
    ["import { readFileSync } from 'node:fs';", 'a Node built-in'],
    ["import { renderEmailHtml } from '@endora-commerce/email-components';", "the package's React root"],
    ["import { Badge } from '../storefront/Badge.js';", "the package's own storefront layer"],
  ])('an e-mail layer importing %s (%s)', (line) => {
    expect(
      kindsOver({
        'src/email/extra.ts': `${line}\nexport const extra = 1;\n`,
      }),
    ).toEqual(['email-layer-import']);
  });

  it.each([
    ['body { margin: 0; }', 'an element selector'],
    ['.badge { color: red; }', 'a class without the module prefix'],
    ['.crm-badge, .other { color: red; }', 'one unscoped selector in a list'],
    ['@import "tailwindcss";', '@import'],
    ['@tailwind utilities;', '@tailwind'],
    ['@source "./dist";', '@source'],
    ['@keyframes spin { from { opacity: 0; } to { opacity: 1; } }', 'a global keyframes name'],
    ['@media (min-width: 1px) { a { color: red; } }', 'an unscoped selector inside @media'],
  ])('a stylesheet with %s (%s)', (css) => {
    expect(kindsOver({ 'blocks.css': `.crm-badge { color: red; }\n${css}\n` })).toEqual([
      'unscoped-stylesheet',
    ]);
  });

  it('a layer whose sources are there and whose subpath is not', () => {
    expect(
      kindsOver({
        'package.json': manifestWithExports((exportsMap) => {
          delete exportsMap['./storefront'];
        }),
      }),
    ).toEqual(['layer-without-subpath']);
  });
});

describe('check-block-renderers — what it must not refuse', () => {
  it('the allowed storefront imports, a relative import inside the layer, and sanitised HTML', () => {
    expect(
      kindsOver({
        'src/storefront/extra.tsx':
          "import { useState } from 'react';\n" +
          "import { createPortal } from 'react-dom';\n" +
          "import type { ComponentConfig } from '@puckeditor/core';\n" +
          "import { ownerOf } from '@endora-commerce/page-builder-core';\n" +
          "import { useBlockRenderEnvironment } from '@endora-commerce/page-builder-core/contributions';\n" +
          "import { useCmsRender } from '@endora-commerce/cms-components/components/render-context';\n" +
          "import type { PageBuilderContext } from '@endora-commerce/contracts';\n" +
          "import { Badge } from './Badge.js';\n" +
          "import * as cms from '@endora-commerce/cms-components';\n" +
          'export function Extra(props: { html?: string }) {\n' +
          "  return <div dangerouslySetInnerHTML={{ __html: cms.sanitizeRichHtml(props.html ?? '') }} />;\n" +
          '}\n',
      }),
    ).toEqual([]);
  });

  it('the allowed e-mail imports', () => {
    expect(
      kindsOver({
        'src/email/extra.ts':
          "import { escapeAttr } from '@endora-commerce/email-components/render/escape-html';\n" +
          "import type { EmailBlockRenderers } from '@endora-commerce/email-components/render/block-renderers';\n" +
          "import { blockNameRe } from '@endora-commerce/contracts';\n" +
          "import { emailBlocks } from './index.js';\n" +
          'export const extra = [escapeAttr, blockNameRe, emailBlocks] as const;\n' +
          'export type Extra = EmailBlockRenderers;\n',
      }),
    ).toEqual([]);
  });

  it('a scoped stylesheet: nested at-rules, a Tailwind-style prefix, a comment naming an element', () => {
    expect(
      stylesheetOffences(
        '/* body { } is only mentioned here */\n' +
          '.crm-badge:hover > span { color: red; }\n' +
          '.crm\\:flex { display: flex; }\n' +
          '@supports (display: grid) { @media (min-width: 1px) { .crm-badge { display: grid; } } }\n' +
          '@keyframes crm-spin { from { opacity: 0; } to { opacity: 1; } }\n' +
          '@font-face { font-family: "X"; src: url(x.woff2); }\n',
        'crm',
      ),
    ).toEqual([]);
  });

  it('a package with no renderer layer at all — nothing to judge, and nothing found', () => {
    const fixture = createBlockRendererFixture({
      'package.json': manifestWithExports((exportsMap) => {
        delete exportsMap['./storefront'];
        delete exportsMap['./email'];
        delete exportsMap['./admin'];
        delete exportsMap['./blocks.css'];
      }),
      'src/storefront/index.ts': null,
      'src/storefront/Badge.tsx': null,
      'src/email/index.ts': null,
      'src/admin/index.ts': null,
    });
    try {
      const pkg = describeBlockRendererPackage(fixture.dir)!;
      expect(declaredLayerCount(pkg)).toBe(0);
      expect(checkBlockRenderers([pkg])).toMatchObject({ findings: [], claims: 0, layersRead: 0 });
    } finally {
      fixture.cleanup();
    }
  });
});

describe('check-block-renderers — it refuses a vacuous pass', () => {
  it('reports a renderer claim whose manifest declares no readable blocks, instead of passing it', () => {
    const fixture = createBlockRendererFixture({
      'src/manifest.ts': 'const blocks = compute();\nexport const manifest = { id: "crm", blocks };\n',
    });
    try {
      const result = checkBlockRenderers([describeBlockRendererPackage(fixture.dir)!]);
      expect(result.findings).toEqual([]);
      expect(result.unreadableManifests).toEqual(['@acme/mod-crm']);
    } finally {
      fixture.cleanup();
    }
  });

  it('reports a declared stylesheet that is not in the package', () => {
    const fixture = createBlockRendererFixture({ 'blocks.css': null });
    try {
      const result = checkBlockRenderers([describeBlockRendererPackage(fixture.dir)!]);
      expect(result.missingStylesheets).toHaveLength(1);
      expect(result.layersRead).toBe(2);
    } finally {
      fixture.cleanup();
    }
  });

  it('reads a manifest’s blocks and contexts as literals, and says when there are none', () => {
    expect(
      declaredBlocksOf({
        path: 'manifest.ts',
        text: "export const manifest = { blocks: [{ name: 'crm.Badge', contexts: ['cms'] }] };",
      }),
    ).toEqual(new Map([['crm.Badge', new Set(['cms'])]]));
    expect(declaredBlocksOf({ path: 'manifest.ts', text: 'export const manifest = { id: "crm" };' })).toBeNull();
  });
});

describe('check-block-renderers — over this checkout', () => {
  it('finds the acceptance fixtures by their own package manifests', () => {
    const fixtures = acceptanceModulePackages(BACKEND);
    expect(fixtures.some((dir) => dir.endsWith('block-renderers-fixture'))).toBe(true);
  });

  it('exits 0 and reads the fixture that ships all three layers', () => {
    const run = spawnSync('pnpm', ['exec', 'tsx', 'scripts/check-block-renderers.ts'], {
      cwd: BACKEND,
      encoding: 'utf8',
    });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toMatch(/\[block-renderers\] read: files=\d+ sites=\d+ sources=manifest-index:\d+\/\d+,renderer-layers:(\d+)\/\1/);
  }, 120_000);
});
