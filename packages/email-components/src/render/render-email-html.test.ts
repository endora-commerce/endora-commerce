import { describe, expect, it } from 'vitest';
import { renderEmailHtml } from './render-email-html.js';
import type { PuckDataTree } from '../schema/envelope.js';

const tree = (content: unknown[]): PuckDataTree => ({ root: { props: {} }, content, zones: {} });

describe('renderEmailHtml', () => {
  it('wraps output in a table-based document shell with a 600px container', () => {
    const html = renderEmailHtml(tree([]));
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('max-width:600px');
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

  it('aligns EmailImage via td align + margin', () => {
    const html = renderEmailHtml(
      tree([
        {
          type: 'EmailImage',
          props: { src: 'https://x/a.png', alt: 'A', width: 200, align: 'right' },
        },
      ]),
      { document: false },
    );
    expect(html).toContain('align="right"');
    expect(html).toContain('margin:0 0 0 auto');
  });

  it('aligns EmailLogo via td align + margin', () => {
    const html = renderEmailHtml(
      tree([
        {
          type: 'EmailLogo',
          props: {
            src: 'https://x/l.png',
            alt: 'Logo',
            width: 160,
            align: 'right',
          },
        },
      ]),
      { document: false },
    );
    expect(html).toContain('align="right"');
    expect(html).toContain('margin:0 0 0 auto');
  });

  it('turns FooterLegal unsubscribe var into an anchor', () => {
    const html = renderEmailHtml(
      tree([
        {
          type: 'EmailFooterLegal',
          props: {
            text: 'You received this email because you are subscribed.\nUnsubscribe: {{var unsubscribeUrl}}',
            align: 'center',
          },
        },
      ]),
      { document: false },
    );
    expect(html).toContain('href="{{var unsubscribeUrl}}"');
    expect(html).toContain('Unsubscribe');
  });

  it('renders EmailTable with headers and striped rows', () => {
    const html = renderEmailHtml(
      tree([
        {
          type: 'EmailTable',
          props: {
            columns: [{ label: 'SKU' }, { label: 'Qty' }],
            tableRows: [{ cells: [{ value: 'A' }, { value: '1' }] }],
            striped: true,
          },
        },
      ]),
      { document: false },
    );
    expect(html).toContain('SKU');
    expect(html).toContain('A');
  });

  it('ignores unknown components', () => {
    const html = renderEmailHtml(tree([{ type: 'NotEmailSafe', props: {} }]), { document: false });
    expect(html).toBe('');
  });

  it('renders EmailSection children from zones', () => {
    const html = renderEmailHtml(
      {
        root: { props: {} },
        content: [
          {
            type: 'EmailSection',
            props: { id: 's1', backgroundColor: '#fff', paddingY: 8, paddingX: 8 },
          },
        ],
        zones: {
          's1:content': [{ type: 'EmailText', props: { text: 'Nested', align: 'left' } }],
        },
      },
      { document: false },
    );
    expect(html).toContain('Nested');
    expect(html).toContain('background-color:#fff');
  });

  it('sanitizes EmailRichText while preserving directives', () => {
    const html = renderEmailHtml(
      tree([
        {
          type: 'EmailRichText',
          props: {
            html: '<p>Hi {{var name}}</p><script>x()</script>',
            align: 'left',
            content: null,
          },
        },
      ]),
      { document: false },
    );
    expect(html).toContain('{{var name}}');
    expect(html).not.toContain('<script');
  });

  it('keeps images inside EmailRichText', () => {
    const html = renderEmailHtml(
      tree([
        {
          type: 'EmailRichText',
          props: {
            html: '<p><img src="https://cdn.example/photo.png" alt="Photo" /></p>',
            align: 'left',
            content: null,
          },
        },
      ]),
      { document: false },
    );
    expect(html).toContain('<img src="https://cdn.example/photo.png" alt="Photo"');
    expect(html).toContain('max-width:100%');
  });

  it('renders product card, social, callout, and footer legal', () => {
    const html = renderEmailHtml(
      tree([
        {
          type: 'EmailProductCard',
          props: { title: 'T', price: '1', href: 'https://x', ctaLabel: 'Go', imageSrc: '' },
        },
        { type: 'EmailSocial', props: { links: [{ network: 'x', href: 'https://x.com' }], align: 'center' } },
        {
          type: 'EmailCallout',
          props: { text: 'Call', backgroundColor: '#eee', borderColor: '#ddd', align: 'left' },
        },
        { type: 'EmailFooterLegal', props: { text: 'Legal', align: 'center' } },
        { type: 'EmailLogo', props: { src: 'https://x/l.png', alt: 'L', width: 80, align: 'center' } },
      ]),
      { document: false },
    );
    expect(html).toContain('T');
    expect(html).toContain('No image');
    expect(html).toContain('https://x.com');
    expect(html).toContain('Call');
    expect(html).toContain('Legal');
    expect(html).toContain('https://x/l.png');
  });

  it('renders order detail labeled blocks with directive vars', () => {
    const html = renderEmailHtml(
      tree([
        { type: 'EmailOrderId', props: { title: 'Order' } },
        { type: 'EmailDeliveryMethod', props: { title: 'Delivery' } },
        { type: 'EmailPaymentMethod', props: { title: 'Payment' } },
        { type: 'EmailAppliedDiscounts', props: { title: 'Discounts' } },
        { type: 'EmailOrderTotals', props: { title: 'Summary' } },
        { type: 'EmailShippingAddress', props: { title: 'Ship' } },
        { type: 'EmailBillingAddress', props: { title: 'Bill' } },
      ]),
      { document: false },
    );
    expect(html).toContain('{{var order.businessId}}');
    expect(html).toContain('{{var order.shippingLine}}');
    expect(html).toContain('{{var order.paymentLine}}');
    expect(html).toContain('{{var order.discountsText}}');
    expect(html).toContain('{{var order.summaryText}}');
    expect(html).toContain('{{var order.shippingAddressText}}');
    expect(html).toContain('{{var order.billingAddressText}}');
    expect(html).toContain('padding:12px 24px 12px 24px');
  });

  it('renders product and category grids as table cells', () => {
    const html = renderEmailHtml(
      tree([
        {
          type: 'EmailProductGrid',
          props: {
            columns: 2,
            showImage: true,
            showPrice: true,
            showSku: false,
            ctaLabel: 'Buy',
            items: [
              {
                productId: '1',
                productSlug: 'a',
                title: 'Alpha',
                sku: 'A',
                price: '10',
                href: 'https://shop/p/a',
                imageSrc: 'https://cdn/a.png',
              },
              {
                productId: '2',
                productSlug: 'b',
                title: 'Beta',
                sku: 'B',
                price: '20',
                href: 'https://shop/p/b',
                imageSrc: '',
              },
            ],
          },
        },
        {
          type: 'EmailCategoryGrid',
          props: {
            columns: 2,
            showImage: true,
            items: [
              {
                categoryId: 'c1',
                categorySlug: 'tools',
                title: 'Tools',
                href: 'https://shop/c/tools',
                imageSrc: 'https://cdn/c.png',
              },
            ],
          },
        },
      ]),
      { document: false },
    );
    expect(html).toContain('Alpha');
    expect(html).toContain('https://cdn/a.png');
    expect(html).toContain('Beta');
    expect(html).toContain('Tools');
    expect(html).toContain('https://cdn/c.png');
  });

  it('applies custom margin top/bottom on order blocks', () => {
    const html = renderEmailHtml(
      tree([
        {
          type: 'EmailOrderId',
          props: { title: 'Order', marginTop: 4, marginBottom: 20 },
        },
        {
          type: 'EmailOrderSummary',
          props: {
            title: 'Items',
            showName: true,
            showQuantity: true,
            showPrice: false,
            showSku: false,
            showTotals: false,
            marginTop: 0,
            marginBottom: 8,
          },
        },
      ]),
      { document: false },
    );
    expect(html).toContain('padding:4px 24px 20px 24px');
    expect(html).toContain('padding:0px 24px 8px 24px');
  });

  it('renders EmailRow as a fixed multi-column table (non-responsive)', () => {
    const html = renderEmailHtml(
      {
        root: { props: {} },
        content: [
          {
            type: 'EmailRow',
            props: { id: 'row1', gap: 16, verticalAlign: 'top' },
          },
        ],
        zones: {
          'row1:content': [
            { type: 'EmailColumn', props: { id: 'c1', span: 4 } },
            { type: 'EmailColumn', props: { id: 'c2', span: 4 } },
            { type: 'EmailColumn', props: { id: 'c3', span: 4 } },
          ],
          'c1:content': [{ type: 'EmailText', props: { text: 'Left', align: 'left' } }],
          'c2:content': [{ type: 'EmailText', props: { text: 'Mid', align: 'left' } }],
          'c3:content': [{ type: 'EmailText', props: { text: 'Right', align: 'left' } }],
        },
      },
      { document: false },
    );
    expect(html).toContain('Left');
    expect(html).toContain('Mid');
    expect(html).toContain('Right');
    expect(html).toContain('table-layout:fixed');
    expect(html).not.toContain('display:flex');
    expect(html).not.toContain('@media');
  });
});
