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
    { type: 'EmailRichText', props: { content: null, html: '<p>Rich <strong>{{var order.id}}</strong></p>', align: 'left' } },
    { type: 'EmailButton', props: { label: 'Pay', href: 'https://x/y', align: 'center' } },
    { type: 'EmailImage', props: { src: 'https://x/logo.png', alt: 'Logo', width: 120, align: 'center' } },
    { type: 'EmailLogo', props: { src: '{{var branding.logoUrl}}', alt: 'Logo', width: 160, align: 'center' } },
    { type: 'EmailDivider', props: { thickness: 1, color: '#e5e7eb' } },
    { type: 'EmailSpacer', props: { height: 24 } },
    {
      type: 'EmailTable',
      props: {
        columns: [{ label: 'A' }, { label: 'B' }],
        tableRows: [{ cells: [{ value: '1' }, { value: '2' }] }],
        striped: false,
      },
    },
    {
      type: 'EmailSection',
      props: {
        id: 'sec1',
        backgroundColor: '#f9fafb',
        paddingY: 12,
        paddingX: 16,
      },
    },
    {
      type: 'EmailProductCard',
      props: {
        imageSrc: 'https://x/p.png',
        title: 'Widget',
        price: '$9',
        href: 'https://x/p',
        ctaLabel: 'Buy',
      },
    },
    {
      type: 'EmailOrderSummary',
      props: {
        title: 'Items',
        body: '{{for item in order.items}}{{var item.name}}\n{{/for}}',
      },
    },
    {
      type: 'EmailOrderId',
      props: { title: 'Order' },
    },
    {
      type: 'EmailBillingAddress',
      props: { title: 'Billing address' },
    },
    {
      type: 'EmailSocial',
      props: { links: [{ network: 'facebook', href: 'https://facebook.com/x' }], align: 'center' },
    },
    {
      type: 'EmailCallout',
      props: { text: 'Notice', backgroundColor: '#eee', borderColor: '#ccc', align: 'left' },
    },
    {
      type: 'EmailFooterLegal',
      props: { text: 'Unsub {{var unsubscribeUrl}}', align: 'center' },
    },
  ],
  zones: {
    'sec1:content': [{ type: 'EmailText', props: { text: 'Inside section', align: 'left' } }],
  },
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
    expect(text).toContain('Inside section');
    expect(text).toContain('Widget');
    expect(text.length).toBeGreaterThan(0);
  });

  it('keeps directive markers through rich text HTML', () => {
    expect(html).toContain('{{var order.id}}');
    expect(html).toContain('{{for item in order.items}}');
    expect(html).toContain('{{var order.businessId}}');
    expect(html).toContain('{{var order.billingAddressText}}');
    expect(html).toContain('Inside section');
  });
});
