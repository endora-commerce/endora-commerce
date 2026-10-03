import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { render } from '@testing-library/react';
import { Puck, usePuck, type ComponentConfig, type Config } from '@puckeditor/core';
import { countBlockNames } from '@endora-commerce/page-builder-core';
import {
  defaultEmailBuilderConfig,
  renderEmailHtml,
  type EmailBlockRenderer,
} from '@endora-commerce/email-components';
import { withMissingBlockPlaceholders } from '@endora-commerce/cms-components';
import type { OwnedBlockContribution } from '@endora-commerce/admin-kit/zones';
import {
  composeEmailBlocks,
  emailBlockEditorConfig,
  loadEmailBlockRenderers,
  type DeclaredEmailBlock,
} from '../../../../packages/page-builder-admin/src/email/email-block-editor-config';

/**
 * `specs/141-module-block-renderers/` US3 scenario 2 and FR-016 — the e-mail
 * editor draws a module's contributed block with the **same function the send
 * path runs**, and a stored block nothing can render is a visible placeholder
 * that keeps its props (contract R4.3).
 *
 * Over the merge, not a running editor, for `block-degradation.test.tsx`'s
 * reason: Puck paints its canvas into an iframe jsdom will not draw.
 */

const BASE = (defaultEmailBuilderConfig.components ?? {}) as Record<string, ComponentConfig>;
const SENTENCE = 'This block has no preview in the editor.';

const badge: EmailBlockRenderer<{ text?: string; explode?: boolean }> = {
  defaultProps: { text: 'default-text' },
  html: (props) => {
    if (props.explode === true) throw new Error('boom');
    return `<tr><td>crm-badge:${String(props.text)}</td></tr>`;
  },
};

const declared: DeclaredEmailBlock = {
  name: 'crm.Badge',
  ownerModule: 'crm',
  contexts: ['email'],
  fields: { text: { type: 'text', label: 'Text' } },
  defaultProps: { text: 'New badge' },
};

const contribution = (
  module: string,
  name: string,
  component: OwnedBlockContribution['component'],
): OwnedBlockContribution => ({ module, name, context: 'email', component });

function canvas(config: ComponentConfig, props: Record<string, unknown>): string {
  return renderToString(createElement(config.render as never, props as never));
}

describe('the e-mail canvas component of a contributed block (R4.3)', () => {
  it('draws the HTML the send path produces for the same props', () => {
    const config = emailBlockEditorConfig('crm.Badge', badge, declared, { language: 'en-US' });
    const html = canvas(config, { id: 'b1', text: 'Gold' });
    const sent = renderEmailHtml(
      { root: { props: {} }, content: [{ type: 'crm.Badge', props: { id: 'b1', text: 'Gold' } }] },
      { document: false, blockRenderers: { 'crm.Badge': badge } },
    );
    expect(sent).toBe('<tr><td>crm-badge:Gold</td></tr>');
    expect(html).toContain('crm-badge:Gold');
  });

  it('takes its fields and default props from the declaration', () => {
    const config = emailBlockEditorConfig('crm.Badge', badge, declared, { language: 'en-US' });
    expect(Object.keys(config.fields ?? {})).toEqual(['text']);
    expect(config.defaultProps).toEqual({ text: 'New badge' });
  });

  it('applies the renderer defaults under the stored props, as the send path does', () => {
    const config = emailBlockEditorConfig('crm.Badge', badge, declared, { language: 'en-US' });
    expect(canvas(config, { id: 'b1' })).toContain('crm-badge:default-text');
  });

  it('shows a note instead of an empty canvas when the renderer throws', () => {
    const config = emailBlockEditorConfig('crm.Badge', badge, declared, { language: 'en-US' });
    const html = canvas(config, { id: 'b1', explode: true });
    expect(html).toContain('crm.Badge');
    expect(html).toContain('role="note"');
    expect(html).not.toContain('crm-badge:');
  });
});

describe('loading and composing the contributed e-mail renderers', () => {
  it('loads the wanted factories and reports one that rejects or is not a renderer', async () => {
    const report = vi.fn();
    const loaded = await loadEmailBlockRenderers(
      [
        contribution('crm', 'crm.Badge', () => Promise.resolve({ default: badge })),
        contribution('crm', 'crm.Card', () => Promise.reject(new Error('chunk failed'))),
        contribution('crm', 'crm.Row', () => Promise.resolve({ default: { text: () => 'x' } })),
        contribution('crm', 'crm.NotWanted', () => Promise.resolve({ default: badge })),
      ],
      new Set(['crm.Badge', 'crm.Card', 'crm.Row']),
      report,
    );
    expect(Object.keys(loaded.renderers)).toEqual(['crm.Badge']);
    expect(loaded.owners).toEqual({ 'crm.Badge': 'crm' });
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('adds the contributed block, and gives a declared block with no renderer the declared-fields editor', () => {
    const other: DeclaredEmailBlock = { ...declared, name: 'overlay_crm.Banner', ownerModule: 'overlay_crm' };
    const composed = composeEmailBlocks({
      components: BASE,
      declared: [declared, other],
      renderers: { 'crm.Badge': badge },
      owners: { 'crm.Badge': 'crm' },
      previewSentence: SENTENCE,
      language: 'en-US',
    });
    expect(canvas(composed.components['crm.Badge']!, { id: 'b1', text: 'Gold' })).toContain(
      'crm-badge:Gold',
    );
    const banner = composed.components['overlay_crm.Banner']!;
    expect(Object.keys(banner.fields ?? {})).toEqual(['text']);
    expect(canvas(banner, { id: 'b2' })).toContain(SENTENCE);
    // What the HTML preview is handed: only what a module really contributed.
    expect(Object.keys(composed.blockRenderers)).toEqual(['crm.Badge']);
  });

  it('never replaces a first-party block and drops a foreign contribution', () => {
    const report = vi.fn();
    const firstParty = 'transactional_emails.EmailText';
    const composed = composeEmailBlocks({
      components: BASE,
      declared: [{ ...declared, name: firstParty, ownerModule: 'transactional_emails' }, declared],
      renderers: { [firstParty]: badge, 'crm.Badge': badge },
      owners: { [firstParty]: 'transactional_emails', 'crm.Badge': 'loyalty' },
      previewSentence: SENTENCE,
      language: 'en-US',
      report,
    });
    expect(composed.components[firstParty]).toBe(BASE[firstParty]);
    expect(Object.keys(composed.blockRenderers)).toEqual([]);
    expect(canvas(composed.components['crm.Badge']!, { id: 'b1' })).toContain(SENTENCE);
    expect(report).toHaveBeenCalledTimes(2);
  });
});

describe('a stored e-mail block nothing can render (FR-016)', () => {
  const stored = {
    root: { props: {} },
    content: [
      { type: 'transactional_emails.EmailText', props: { id: 't1', text: 'kept', align: 'left' } },
      { type: 'crm.Badge', props: { id: 'b1', text: 'Gold', nested: { a: [1, 2] } } },
    ],
    zones: {},
  };
  const names = [...countBlockNames(stored).keys()];

  it('is a visible placeholder naming the block and its module', () => {
    const merged = withMissingBlockPlaceholders({ components: BASE } as Config, names);
    const placeholder = (merged.components as Record<string, ComponentConfig>)['crm.Badge']!;
    const html = renderToString(
      createElement(placeholder.render as never, { ...(placeholder.defaultProps ?? {}) } as never),
    );
    expect(html).toContain('crm.Badge');
    expect(html).toContain('crm');
    expect(merged.components!['transactional_emails.EmailText']).toBe(
      BASE['transactional_emails.EmailText'],
    );
  });

  it('survives a save round-trip unchanged', () => {
    const serialised = JSON.stringify(stored);
    const merged = withMissingBlockPlaceholders({ components: BASE } as Config, names);
    const sink: { data?: unknown } = {};
    function Spy(): null {
      const { appState } = usePuck();
      sink.data = appState.data;
      return null;
    }
    render(
      createElement(
        Puck,
        { config: merged as never, data: stored as never, onPublish: () => {} } as never,
        createElement(Spy),
      ),
    );
    expect(JSON.stringify(sink.data)).toBe(serialised);
  });
});

describe('the pane reaches all of it', () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../packages/page-builder-admin/src/email/EmailEditorPane.tsx',
    ),
    'utf8',
  );

  it('reads the email contributions, composes them and merges the placeholders', () => {
    expect(source).toContain("useBlockContributions('email')");
    expect(source).toContain('loadEmailBlockRenderers(');
    expect(source).toContain('composeEmailBlocks(');
    expect(source).toContain('withMissingBlockPlaceholders(');
  });

  it('hands the loaded renderers to both renderEmailHtml calls', () => {
    const calls = source.split('renderEmailHtml(').slice(1);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.slice(0, call.indexOf('});'))).toContain('blockRenderers');
    }
  });
});
