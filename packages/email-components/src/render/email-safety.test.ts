import { describe, expect, it } from 'vitest';
import { renderEmailHtml } from './render-email-html.js';
import { renderEmailText } from './render-email-text.js';
import type { PuckDataTree } from '../schema/envelope.js';

// A tree exercising every email-safe component.
const fullTree: PuckDataTree = {
  root: { props: {} },
  content: [
    { type: 'EmailHeading', props: { level: 'h1', text: 'Title', align: 'center' } },
    { type: 'EmailText', props: { text: 'Body line', align: 'left' } },
    { type: 'EmailButton', props: { label: 'Pay', href: 'https://x/y', align: 'center' } },
    { type: 'EmailImage', props: { src: 'https://x/logo.png', alt: 'Logo', width: 120, align: 'center' } },
    { type: 'EmailDivider', props: {} },
    { type: 'EmailSpacer', props: { height: 24 } },
    { type: 'EmailColumns', props: { columns: [{ text: 'A' }, { text: 'B' }] } },
  ],
  zones: {},
};

describe('email-safety invariants', () => {
  const html = renderEmailHtml(fullTree);

  it('never emits constructs that break common email clients', () => {
    for (const banned of ['display:flex', 'display:grid', '<script', '<style', 'position:absolute', 'position:fixed', 'javascript:']) {
      expect(html.includes(banned), `must not contain ${banned}`).toBe(false);
    }
  });

  it('uses a table-based layout with role=presentation', () => {
    expect(html).toContain('role="presentation"');
    expect(html).toContain('<table');
  });

  it('produces a non-empty plain-text alternative for the same tree', () => {
    const text = renderEmailText(fullTree);
    expect(text).toContain('Title');
    expect(text).toContain('Body line');
    expect(text.length).toBeGreaterThan(0);
  });
});
