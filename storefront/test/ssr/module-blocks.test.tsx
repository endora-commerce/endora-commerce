import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComponentConfig } from '@puckeditor/core';
import { createElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '@endora-commerce/cms-components';
import {
  useBlockRenderEnvironment,
  type StorefrontContributions,
} from '@endora-commerce/page-builder-core/contributions';

import { BlockRenderScope } from '../../components/BlockRenderScope';
import { PageBuilderRender } from '../../components/PageBuilderRender';
import { composeStorefrontConfig } from '../../lib/page-builder/config';
import { blockPresenceOf } from '../../lib/page-builder/presence';

/**
 * `specs/141-module-block-renderers/` US1, US4 and US5 on the storefront: a
 * module's block is part of the server-rendered HTML, an absent owner's block
 * reaches no customer, a client's own local block renders, and a throwing block
 * costs only itself (contract §5.2, §7, §8).
 *
 * SSR-only, as every storefront component test is: `renderToString`, node
 * environment. The fixture contribution is handed to the composer directly —
 * the registry that would carry it is generated from `node_modules`, and
 * `block-registry.test.ts` holds that half.
 */

/**
 * What the two files the composer reads would hold. The generated registry is
 * written from `node_modules` and `local-blocks.tsx` is the storefront owner's
 * own, so both are replaced here by a holder each case fills.
 */
const installed = vi.hoisted(() => ({
  packages: [] as { moduleId: string; contributions: unknown }[],
  local: {} as Record<string, unknown>,
}));

vi.mock('../../lib/page-builder/blocks.generated', () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the generated export's own name.
  get STOREFRONT_BLOCK_CONTRIBUTIONS() {
    return installed.packages;
  },
}));
vi.mock('../../lib/page-builder/local-blocks', () => ({
  get localBlocks() {
    return installed.local;
  },
}));

function Badge(props: { text?: string; tone?: string; explode?: boolean }): ReactNode {
  const environment = useBlockRenderEnvironment();
  if (props.explode === true) throw new Error('boom-in-a-module-block');
  return (
    <span data-tone={props.tone} data-language={environment.language}>
      crm-badge:{String(props.text)}
    </span>
  );
}

const crm: StorefrontContributions = {
  blocks: {
    'crm.Badge': { defaultProps: { tone: 'neutral' }, render: Badge } as unknown as ComponentConfig,
  },
};

const local: StorefrontContributions['blocks'] = {
  'overlay_crm.Banner': {
    render: (props: { text?: string }) => <aside>overlay-banner:{String(props.text)}</aside>,
  } as unknown as ComponentConfig,
};

const NOBODY_ABSENT = { absent: [] };

const document = (content: readonly unknown[]): unknown => ({
  root: { props: {} },
  content,
  zones: {},
});

function ssr(
  content: readonly unknown[],
  options: {
    absent?: readonly string[];
    preview?: boolean;
    language?: string;
    packages?: readonly { moduleId: string; contributions: StorefrontContributions }[];
  } = {},
): string {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  installed.packages = [...(options.packages ?? [{ moduleId: 'crm', contributions: crm }])];
  installed.local = { ...local };
  try {
    return renderToString(
      createElement(PageBuilderRender, {
        data: document(content),
        presence: { absent: options.absent ?? [] },
        language: options.language ?? 'en-US',
        preview: options.preview ?? false,
      }),
    );
  } finally {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  }
}

const badge = (id: string, props: Record<string, unknown> = {}): unknown => ({
  type: 'crm.Badge',
  props: { id, text: 'Gold', ...props },
});
const text = (id: string, value: string): unknown => ({
  type: 'cms.Text',
  props: { ...(defaultPageBuilderConfig.components?.['cms.Text']?.defaultProps ?? {}), id, text: value },
});

describe('a module package’s block on the storefront (US1)', () => {
  it('is in the server-rendered HTML, with its defaults and the request language', () => {
    const html = ssr([badge('b1')], { language: 'pl-PL' });
    expect(html).toContain('crm-badge:<!-- -->Gold');
    expect(html).toContain('data-tone="neutral"');
    expect(html).toContain('data-language="pl-PL"');
  });

  it('renders nothing for a block no installed package draws', () => {
    const html = ssr([badge('b1')], { packages: [] });
    expect(html).not.toContain('crm-badge');
    expect(html).not.toContain('crm.Badge');
  });

  it('never replaces a first-party block, and drops a foreign contribution', () => {
    const hijack = {
      moduleId: 'crm',
      contributions: {
        blocks: {
          'cms.Text': { render: () => <b>HIJACKED</b> } as unknown as ComponentConfig,
          'loyalty.Points': { render: () => <b>FOREIGN</b> } as unknown as ComponentConfig,
        },
      },
    };
    const composed = composeStorefrontConfig({
      base: defaultPageBuilderConfig,
      packages: [hijack],
      local: {},
      presence: NOBODY_ABSENT,
      preview: false,
    });
    expect(composed.config.components?.['cms.Text']).toBe(
      defaultPageBuilderConfig.components?.['cms.Text'],
    );
    expect(composed.config.components?.['loyalty.Points']).toBeUndefined();
    expect(composed.ignored).toHaveLength(2);
  });
});

describe('an absent owner (US4, FR-015)', () => {
  it('lets nothing of the block reach a customer', () => {
    const html = ssr([text('t1', 'kept-text'), badge('b1')], { absent: ['crm'] });
    expect(html).toContain('kept-text');
    expect(html).not.toContain('crm-badge');
    expect(html).not.toContain('crm.Badge');
    expect(html).not.toContain('Missing CMS component');
  });

  it('shows the missing-renderer note in preview', () => {
    const html = ssr([badge('b1')], { absent: ['crm'], preview: true });
    expect(html).toContain('Missing CMS component');
    expect(html).toContain('crm.Badge');
    expect(html).not.toContain('crm-badge');
  });

  it('applies to a first-party block by its owner too — one rule, no carve-out', () => {
    const html = ssr([text('t1', 'cms-text-under-absent-cms'), badge('b1')], { absent: ['cms'] });
    expect(html).not.toContain('cms-text-under-absent-cms');
    expect(html).toContain('crm-badge:<!-- -->Gold');
  });

  it('renders again when the owner is back, from the same stored document', () => {
    const content = [badge('b1')];
    const before = JSON.stringify(content);
    expect(ssr(content, { absent: ['crm'] })).not.toContain('crm-badge');
    expect(ssr(content)).toContain('crm-badge:<!-- -->Gold');
    expect(JSON.stringify(content)).toBe(before);
  });
});

describe('a local block (US5)', () => {
  it('renders, though no installed package and no presence entry names its owner', () => {
    const html = ssr([{ type: 'overlay_crm.Banner', props: { id: 'o1', text: 'hello' } }], {
      absent: ['catalog'],
    });
    expect(html).toContain('overlay-banner:<!-- -->hello');
  });
});

describe('a block that throws (FR-012)', () => {
  it('leaves its siblings intact and reaches no customer', () => {
    const html = ssr([
      text('t1', 'sibling-before'),
      badge('b1', { explode: true }),
      badge('b2', { text: 'Silver' }),
      text('t2', 'sibling-after'),
    ]);
    expect(html).toContain('sibling-before');
    expect(html).toContain('sibling-after');
    expect(html).toContain('crm-badge:<!-- -->Silver');
    expect(html).not.toContain('crm-badge:<!-- -->Gold');
    expect(html).not.toContain('Missing CMS component');
  });

  it('degrades to the missing-renderer note in preview', () => {
    const html = ssr([badge('b1', { explode: true })], { preview: true });
    expect(html).toContain('Missing CMS component');
  });
});

describe('presence, as the server context resolves it', () => {
  it('reports the modules the backend says are not present, and only those', () => {
    expect(
      blockPresenceOf({ isPresent: () => true, presentIds: ['cms'], absentIds: ['crm'] }),
    ).toEqual({ absent: ['crm'] });
  });

  it('reports nobody absent when presence could not be read', () => {
    expect(blockPresenceOf({ isPresent: () => true, presentIds: [], absentIds: [] })).toEqual({
      absent: [],
    });
  });
});

describe('the render scope', () => {
  it('supplies presence and language to a render site that passes neither', () => {
    const page = document([text('t1', 'scoped-text'), badge('b1')]);
    installed.packages = [{ moduleId: 'crm', contributions: crm }];
    const html = renderToString(
      <BlockRenderScope presence={{ absent: ['cms'] }} language="pl-PL">
        <PageBuilderRender data={page} />
      </BlockRenderScope>,
    );
    expect(html).not.toContain('scoped-text');
    expect(html).toContain('data-language="pl-PL"');
  });

  it('refuses a render site with neither a scope nor a presence of its own', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() =>
        renderToString(createElement(PageBuilderRender, { data: document([]) })),
      ).toThrow(/BlockRenderScope/);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('every render site goes through the composer (R5.2.2)', () => {
  const STOREFRONT = fileURLToPath(new URL('../..', import.meta.url));

  function sources(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'test' || entry.startsWith('.')) {
        continue;
      }
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) sources(path, found);
      else if (/\.(ts|tsx|mjs)$/.test(entry)) found.push(path);
    }
    return found;
  }

  it('names defaultPageBuilderConfig in lib/page-builder/config.ts and nowhere else', () => {
    const files = sources(STOREFRONT);
    expect(files.length).toBeGreaterThan(100);
    const naming = files
      .filter((file) => readFileSync(file, 'utf8').includes('defaultPageBuilderConfig'))
      .map((file) => relative(STOREFRONT, file));
    expect(naming).toEqual(['lib/page-builder/config.ts']);
  });

  it('mounts Puck’s <Render> in PageBuilderRender and nowhere else', () => {
    const mounting = sources(STOREFRONT)
      // The import, not the word: several files explain `<Render>` in prose.
      .filter((file) =>
        /import\s*\{[^}]*\bRender\b[^}]*\}\s*from\s*'@puckeditor\/core'/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(STOREFRONT, file));
    expect(mounting).toEqual(['components/PageBuilderRender.tsx']);
  });
});
