import { describe, expect, it } from 'vitest';
import { renderEmailHtml } from './render-email-html.js';
import type { PuckDataTree } from '../schema/envelope.js';

const tree = (content: unknown[]): PuckDataTree => ({ root: { props: {} }, content, zones: {} });

describe('renderEmailHtml', () => {
  it('wraps output in a table-based document shell with a 600px container', () => {
    const html = renderEmailHtml(tree([]));
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('width="600"');
    expect(html).toContain('role="presentation"');
    // No email-unsafe layout primitives.
    expect(html).not.toContain('display:flex');
    expect(html).not.toContain('display:grid');
    expect(html).not.toContain('<script');
  });

  it('renders a heading with inline styles and escapes text', () => {
    const html = renderEmailHtml(tree([{ type: 'EmailHeading', props: { level: 'h1', text: 'Hi <b>', align: 'center' } }]));
    expect(html).toContain('<h1');
    expect(html).toContain('text-align:center');
    expect(html).toContain('Hi &lt;b&gt;');
  });

  it('preserves directive markers for later substitution', () => {
    const html = renderEmailHtml(tree([{ type: 'EmailText', props: { text: 'Order {{var order.id}}', align: 'left' } }]));
    expect(html).toContain('{{var order.id}}');
  });

  it('converts newlines to <br /> in text', () => {
    const html = renderEmailHtml(tree([{ type: 'EmailText', props: { text: 'a\nb', align: 'left' } }]));
    expect(html).toContain('a<br />b');
  });

  it('resolves block embeds from the embeds map and respects depth cap', () => {
    const html = renderEmailHtml(
      tree([{ type: 'EmailInsertBlock', props: { code: 'footer' } }]),
      { embeds: { blocks: { footer: tree([{ type: 'EmailText', props: { text: 'FOOT', align: 'left' } }]) }, templates: {} } },
    );
    expect(html).toContain('FOOT');
  });

  it('renders a button anchor with href and label', () => {
    const html = renderEmailHtml(tree([{ type: 'EmailButton', props: { label: 'Pay', href: 'https://x/y', align: 'left' } }]));
    expect(html).toContain('href="https://x/y"');
    expect(html).toContain('Pay');
  });

  it('renders columns as a table row of cells', () => {
    const html = renderEmailHtml(
      tree([{ type: 'EmailColumns', props: { columns: [{ text: 'A' }, { text: 'B' }] } }]),
      { document: false },
    );
    expect(html).toContain('A');
    expect(html).toContain('B');
    expect(html).toContain('width:50%');
  });

  it('ignores unknown components', () => {
    const html = renderEmailHtml(tree([{ type: 'NotEmailSafe', props: {} }]), { document: false });
    expect(html).toBe('');
  });
});
