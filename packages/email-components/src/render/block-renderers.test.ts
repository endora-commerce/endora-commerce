import { describe, expect, it, vi } from 'vitest';

import type { PuckDataTree } from '../schema/envelope.js';
import type { EmailBlockRenderers } from './block-renderers.js';
import { escapeHtml } from './escape-html.js';
import { renderEmailHtml } from './render-email-html.js';
import { renderEmailText } from './render-email-text.js';

/**
 * `specs/141-module-block-renderers/contracts/block-renderers.md` §3 — the host
 * half of a module-contributed e-mail renderer (R3.4).
 */

const tree = (content: unknown[], zones: Record<string, unknown[]> = {}): PuckDataTree => ({
  root: { props: {} },
  content,
  zones,
});

const badge: EmailBlockRenderers = {
  'crm.Badge': {
    html: (props: { text?: string }) =>
      `<tr><td>crm-badge:${escapeHtml(String(props.text ?? ''))}</td></tr>`,
    text: (props: { text?: string }) => `crm-badge-text:${String(props.text ?? '')}\n`,
  },
};

describe('contributed e-mail block renderers', () => {
  it('renders a contributed name in HTML and in text', () => {
    const doc = tree([{ type: 'crm.Badge', props: { text: 'Gold <1>' } }]);
    expect(renderEmailHtml(doc, { document: false, blockRenderers: badge })).toBe(
      '<tr><td>crm-badge:Gold &lt;1&gt;</td></tr>',
    );
    expect(renderEmailText(doc, { blockRenderers: badge })).toBe('crm-badge-text:Gold <1>');
  });

  it('renders nothing for a name no renderer answers, as before', () => {
    const doc = tree([{ type: 'crm.Badge', props: { text: 'x' } }]);
    expect(renderEmailHtml(doc, { document: false })).toBe('');
    expect(renderEmailText(doc)).toBe('');
  });

  it('never lets a contribution override a first-party block', () => {
    const hijack: EmailBlockRenderers = {
      'transactional_emails.EmailText': { html: () => '<tr><td>HIJACKED</td></tr>', text: () => 'HIJACKED' },
    };
    const doc = tree([
      { type: 'transactional_emails.EmailText', props: { text: 'original', align: 'left' } },
    ]);
    const html = renderEmailHtml(doc, { document: false, blockRenderers: hijack });
    expect(html).toContain('original');
    expect(html).not.toContain('HIJACKED');
    expect(renderEmailText(doc, { blockRenderers: hijack })).toBe('original');
  });

  it('contributes nothing for a throwing renderer and reports it once, by name', () => {
    const boom = new Error('boom');
    const broken: EmailBlockRenderers = {
      'crm.Badge': {
        html: () => {
          throw boom;
        },
      },
    };
    const doc = tree([
      { type: 'transactional_emails.EmailText', props: { text: 'before', align: 'left' } },
      { type: 'crm.Badge', props: {} },
      { type: 'transactional_emails.EmailText', props: { text: 'after', align: 'left' } },
    ]);
    const onHtml = vi.fn();
    const html = renderEmailHtml(doc, { document: false, blockRenderers: broken, onBlockError: onHtml });
    expect(html).toContain('before');
    expect(html).toContain('after');
    expect(onHtml).toHaveBeenCalledTimes(1);
    expect(onHtml).toHaveBeenCalledWith('crm.Badge', boom);

    const onText = vi.fn();
    expect(renderEmailText(doc, { blockRenderers: broken, onBlockError: onText })).toBe(
      'before\nafter',
    );
    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledWith('crm.Badge', boom);
  });

  it('does not let a throwing renderer escape when no handler is given', () => {
    const broken: EmailBlockRenderers = {
      'crm.Badge': {
        html: () => {
          throw new Error('boom');
        },
      },
    };
    const doc = tree([{ type: 'crm.Badge', props: {} }]);
    expect(renderEmailHtml(doc, { document: false, blockRenderers: broken })).toBe('');
    expect(renderEmailText(doc, { blockRenderers: broken })).toBe('');
  });

  it('derives the text from the HTML when the renderer ships no text function', () => {
    const htmlOnly: EmailBlockRenderers = {
      'crm.Badge': {
        html: (props: { text?: string }) =>
          `<tr><td><strong>crm-badge:${escapeHtml(String(props.text ?? ''))}</strong></td></tr>`,
      },
    };
    const doc = tree([{ type: 'crm.Badge', props: { text: 'Gold' } }]);
    expect(renderEmailText(doc, { blockRenderers: htmlOnly })).toBe('crm-badge:Gold');
  });

  it('merges the renderer defaultProps under the stored props', () => {
    const seen: unknown[] = [];
    const withDefaults: EmailBlockRenderers = {
      'crm.Badge': {
        defaultProps: { text: 'default', tone: 'neutral' },
        html: (props) => {
          seen.push(props);
          return '';
        },
        text: (props) => {
          seen.push(props);
          return '';
        },
      },
    };
    const doc = tree([{ type: 'crm.Badge', props: { id: 'b1', text: 'stored' } }]);
    renderEmailHtml(doc, { document: false, blockRenderers: withDefaults });
    renderEmailText(doc, { blockRenderers: withDefaults });
    expect(seen).toEqual([
      { id: 'b1', text: 'stored', tone: 'neutral' },
      { id: 'b1', text: 'stored', tone: 'neutral' },
    ]);
  });

  it('gives the renderer the language, the accent colour and the host slot renderer', () => {
    const panel: EmailBlockRenderers = {
      'crm.Panel': {
        html: (props: { content?: unknown }, ctx) =>
          `<tr><td data-lang="${ctx.language}" data-accent="${ctx.accentColor}"><table>${ctx.renderSlot(props.content)}</table></td></tr>`,
        text: (props: { content?: unknown }, ctx) => `[${ctx.language}] ${ctx.renderSlot(props.content)}`,
      },
      ...badge,
    };
    const doc = tree([
      {
        type: 'crm.Panel',
        props: {
          id: 'p1',
          content: [
            { type: 'transactional_emails.EmailText', props: { text: 'inner', align: 'left' } },
            { type: 'crm.Badge', props: { text: 'nested' } },
          ],
        },
      },
    ]);
    const html = renderEmailHtml(doc, {
      document: false,
      blockRenderers: panel,
      language: 'pl-PL',
      accentColor: '#ff0000',
    });
    expect(html).toContain('data-lang="pl-PL"');
    expect(html).toContain('data-accent="#ff0000"');
    // A first-party child and a contributed child, both through the host.
    expect(html).toContain('inner');
    expect(html).toContain('crm-badge:nested');

    const text = renderEmailText(doc, { blockRenderers: panel, language: 'pl-PL' });
    expect(text).toBe('[pl-PL] inner\ncrm-badge-text:nested');
  });

  it('leaves directives in a contributed block for the engine to resolve', () => {
    const directive: EmailBlockRenderers = {
      'crm.Badge': { html: () => '<tr><td>{{var customer.name}}</td></tr>' },
    };
    const doc = tree([{ type: 'crm.Badge', props: {} }]);
    expect(renderEmailHtml(doc, { document: false, blockRenderers: directive })).toContain(
      '{{var customer.name}}',
    );
    expect(renderEmailText(doc, { blockRenderers: directive })).toContain('{{var customer.name}}');
  });
});
