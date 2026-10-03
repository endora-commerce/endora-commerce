import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config } from '@puckeditor/core';
import { buildPaletteCategories } from '@endora-commerce/page-builder-core';
import type { PageBuilderBlockEditorConfig } from '@endora-commerce/page-builder-core/contributions';
import type { OwnedBlockContribution } from '@endora-commerce/admin-kit/zones';
import {
  defaultPageBuilderConfig,
  withMissingBlockPlaceholders,
} from '@endora-commerce/cms-components';
import {
  composeDeclaredBlocks,
  loadBlockEditors,
  namesToLoad,
  type DeclaredBlock,
} from '../../../../packages/modules/cms/src/admin/components/block-contributions';

/**
 * `specs/141-module-block-renderers/` US2 — a module's block renders and edits
 * in the CMS editor (contract §4, R4.2; plan D8; FR-014, FR-016).
 *
 * As in `block-degradation.test.tsx`, the assertions are over the **merge** and
 * not over a running editor: Puck paints its canvas into an iframe jsdom will
 * not draw. What the canvas would draw is rendered here with Puck's own
 * `<Render>` through `react-dom/server`; the wiring that reaches the merge is
 * asserted at the end.
 */

const BASE = (defaultPageBuilderConfig.components ?? {}) as Record<string, ComponentConfig>;
const PREVIEW_SENTENCE = 'No preview is available for this block in the editor.';

const declaredBadge: DeclaredBlock = {
  name: 'crm.Badge',
  ownerModule: 'crm',
  contexts: ['cms'],
  category: 'crm',
  fields: {
    text: { type: 'text', label: 'Text' },
    tone: { type: 'select', label: 'Tone', options: [{ label: 'Gold', value: 'gold' }] },
  },
  defaultProps: { text: 'New badge', tone: 'gold' },
};

const badgeEditor: PageBuilderBlockEditorConfig = {
  render: ((props: { text?: string; explode?: boolean }) => {
    if (props.explode === true) throw new Error('boom');
    return <strong>crm-badge:{String(props.text)}</strong>;
  }) as never,
  fields: { tone: { type: 'radio', label: 'Tone (picker)', options: [{ label: 'Gold', value: 'gold' }] } },
};

function contribution(
  module: string,
  name: string,
  component: OwnedBlockContribution['component'],
): OwnedBlockContribution {
  return { module, name, context: 'cms', component };
}

function draw(components: Record<string, ComponentConfig>, content: unknown[]): string {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    return renderToString(
      <Render config={{ components } as Config} data={{ root: { props: {} }, content } as never} />,
    );
  } finally {
    consoleError.mockRestore();
  }
}

describe('loading the contributed editor renderers (R4.2)', () => {
  it('loads only the factories of declared names this bundle does not already render', async () => {
    const wanted = vi.fn(() => Promise.resolve({ default: badgeEditor }));
    const notDeclared = vi.fn(() => Promise.resolve({ default: badgeEditor }));
    const alreadyBundled = vi.fn(() => Promise.resolve({ default: badgeEditor }));
    const names = namesToLoad([declaredBadge, { ...declaredBadge, name: 'cms.Text', ownerModule: 'cms' }], BASE);
    expect([...names]).toEqual(['crm.Badge']);

    const loaded = await loadBlockEditors(
      [
        contribution('crm', 'crm.Badge', wanted),
        contribution('crm', 'crm.Other', notDeclared),
        contribution('cms', 'cms.Text', alreadyBundled),
      ],
      names,
    );
    expect(wanted).toHaveBeenCalledTimes(1);
    expect(notDeclared).not.toHaveBeenCalled();
    expect(alreadyBundled).not.toHaveBeenCalled();
    expect(Object.keys(loaded.editors)).toEqual(['crm.Badge']);
    expect(loaded.failed).toEqual([]);
  });

  it('reports a factory that rejects, and one whose default export is not an editor config', async () => {
    const report = vi.fn();
    const loaded = await loadBlockEditors(
      [
        contribution('crm', 'crm.Badge', () => Promise.reject(new Error('chunk failed'))),
        contribution('crm', 'crm.Card', () => Promise.resolve({ default: { fields: {} } })),
      ],
      new Set(['crm.Badge', 'crm.Card']),
      report,
    );
    expect(loaded.editors).toEqual({});
    expect(loaded.failed).toEqual(['crm.Badge', 'crm.Card']);
    expect(report).toHaveBeenCalledTimes(2);
    expect(String(report.mock.calls[0]?.[0])).toContain('crm.Badge');
    expect(String(report.mock.calls[0]?.[0])).toContain('crm');
  });
});

describe('composing the declared blocks into the editor config', () => {
  it('uses a contributed renderer, with the declaration’s fields and the contribution’s overrides', () => {
    const components = composeDeclaredBlocks({
      components: BASE,
      declared: [declaredBadge],
      editors: { 'crm.Badge': badgeEditor },
      owners: { 'crm.Badge': 'crm' },
      previewSentence: PREVIEW_SENTENCE,
    });
    const badge = components['crm.Badge']!;
    expect(Object.keys(badge.fields ?? {})).toEqual(['text', 'tone']);
    expect((badge.fields as Record<string, { type: string }>)['tone']?.type).toBe('radio');
    expect(badge.defaultProps).toEqual({ text: 'New badge', tone: 'gold' });

    const html = draw(components, [{ type: 'crm.Badge', props: { id: 'b1', text: 'Gold' } }]);
    expect(html).toContain('crm-badge:<!-- -->Gold');
  });

  it('gives a declared block with no renderer an editor built from its declared fields (D8)', () => {
    const components = composeDeclaredBlocks({
      components: BASE,
      declared: [declaredBadge],
      editors: {},
      owners: {},
      previewSentence: PREVIEW_SENTENCE,
    });
    const badge = components['crm.Badge']!;
    // Editable: the manifest's fields, not the placeholder's two.
    expect(Object.keys(badge.fields ?? {})).toEqual(['text', 'tone']);
    expect(Object.keys(badge.fields ?? {})).not.toContain('componentName');
    expect(badge.defaultProps).toEqual({ text: 'New badge', tone: 'gold' });

    const html = draw(components, [{ type: 'crm.Badge', props: { id: 'b1', text: 'Gold' } }]);
    expect(html).toContain('crm.Badge');
    expect(html).toContain(PREVIEW_SENTENCE);
    expect(html).not.toContain('Missing CMS component');
  });

  it('falls back to that editor when the factory rejected', async () => {
    const loaded = await loadBlockEditors(
      [contribution('crm', 'crm.Badge', () => Promise.reject(new Error('chunk failed')))],
      new Set(['crm.Badge']),
      () => undefined,
    );
    const components = composeDeclaredBlocks({
      components: BASE,
      declared: [declaredBadge],
      editors: loaded.editors,
      owners: { 'crm.Badge': 'crm' },
      previewSentence: PREVIEW_SENTENCE,
    });
    expect(Object.keys(components['crm.Badge']?.fields ?? {})).toEqual(['text', 'tone']);
    expect(draw(components, [{ type: 'crm.Badge', props: { id: 'b1' } }])).toContain(PREVIEW_SENTENCE);
  });

  it('never replaces a renderer this bundle already carries', () => {
    const report = vi.fn();
    const components = composeDeclaredBlocks({
      components: BASE,
      declared: [{ ...declaredBadge, name: 'cms.Text', ownerModule: 'cms' }],
      editors: { 'cms.Text': badgeEditor },
      owners: { 'cms.Text': 'cms' },
      previewSentence: PREVIEW_SENTENCE,
      report,
    });
    expect(components['cms.Text']).toBe(BASE['cms.Text']);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('drops a renderer contributed by a module the block does not belong to', () => {
    const report = vi.fn();
    const components = composeDeclaredBlocks({
      components: BASE,
      declared: [declaredBadge],
      editors: { 'crm.Badge': badgeEditor },
      owners: { 'crm.Badge': 'loyalty' },
      previewSentence: PREVIEW_SENTENCE,
      report,
    });
    // Not the foreign renderer: the block degrades to the declared-fields editor.
    expect(draw(components, [{ type: 'crm.Badge', props: { id: 'b1', text: 'Gold' } }])).toContain(
      PREVIEW_SENTENCE,
    );
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('degrades a contributed renderer that throws to the placeholder, and only it', () => {
    const components = composeDeclaredBlocks({
      components: BASE,
      declared: [declaredBadge],
      editors: { 'crm.Badge': badgeEditor },
      owners: { 'crm.Badge': 'crm' },
      previewSentence: PREVIEW_SENTENCE,
    });
    const html = draw(components, [
      { type: 'crm.Badge', props: { id: 'b1', text: 'First' } },
      { type: 'crm.Badge', props: { id: 'b2', explode: true } },
      { type: 'crm.Badge', props: { id: 'b3', text: 'Third' } },
    ]);
    expect(html).toContain('crm-badge:<!-- -->First');
    expect(html).toContain('crm-badge:<!-- -->Third');
    expect(html).toContain('Missing CMS component');
  });

  it('offers the declared block in its palette section', () => {
    const components = composeDeclaredBlocks({
      components: BASE,
      declared: [declaredBadge],
      editors: {},
      owners: {},
      previewSentence: PREVIEW_SENTENCE,
    });
    const categories = buildPaletteCategories(
      [declaredBadge],
      [{ key: 'crm', titleKey: 'blocks.section', contexts: ['cms'] }],
      'cms',
      { title: (section) => section.key, renderable: new Set(Object.keys(components)) },
    );
    expect(categories['crm']?.components).toEqual(['crm.Badge']);
  });
});

describe('a stored block whose owner is absent (FR-016)', () => {
  it('is a visible placeholder and is not in the palette', () => {
    // The owner is off, so the descriptor does not declare the block and
    // nothing above composes it. The stored document is the one place the name
    // is still written, and the existing degradation merge covers it.
    const components = composeDeclaredBlocks({
      components: BASE,
      declared: [],
      editors: {},
      owners: {},
      previewSentence: PREVIEW_SENTENCE,
    });
    expect(components['crm.Badge']).toBeUndefined();

    const degraded = withMissingBlockPlaceholders({ components } as Config, ['crm.Badge']);
    const html = draw(degraded.components as Record<string, ComponentConfig>, [
      { type: 'crm.Badge', props: { id: 'b1', text: 'Gold' } },
    ]);
    expect(html).toContain('Missing CMS component');
    expect(html).toContain('crm.Badge');

    const categories = buildPaletteCategories([], [], 'cms', {
      title: (section) => section.key,
      renderable: new Set(Object.keys(components)),
    });
    expect(Object.values(categories).flatMap((c) => c.components ?? [])).not.toContain('crm.Badge');
  });
});

describe('the editor reaches the composition', () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../packages/modules/cms/src/admin/components/PageBuilderEditor.tsx',
    ),
    'utf8',
  );

  it('reads the cms contributions, loads them before the config is built, and composes them', () => {
    expect(source).toContain("useBlockContributions('cms')");
    expect(source).toContain('loadBlockEditors(');
    expect(source).toContain('composeDeclaredBlocks(');
    // The uneditable placeholder is no longer what a declared block gets.
    expect(source).not.toContain('makeMissingComponentConfig(entry.name');
  });
});
