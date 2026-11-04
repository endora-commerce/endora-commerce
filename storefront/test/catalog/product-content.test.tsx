import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ProductPageContentAttribute } from '@endora-commerce/contracts';
import { BlockRenderScope } from '../../components/BlockRenderScope';
import { ProductContent } from '../../components/catalog/ProductContent';
import { ProductDescriptionPanel } from '../../components/catalog/ProductDescriptionPanel';
import { productTabPlan } from '../../lib/catalog/product-tabs';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-030, FR-034,
 * FR-037, SC-007) — a product's Page Builder content attributes in the "Opis"
 * tab, below the plain description.
 *
 * Drawn through `PageBuilderRender`, the one boundary a CMS page, a blog
 * category description and a category page use, so the blocks, their HTML
 * sanitisation and the module-presence rule are the CMS' own. Server-rendered
 * with the page (Principle VII): `renderToString`, no jsdom. No heading of its
 * own above a document (OR-4).
 */

const richContent = (html: string, type = 'cms.RichContent'): Record<string, unknown> => ({
  root: { props: {} },
  content: [{ type, props: { id: `rc-${html.length}`, html } }],
  zones: {},
});

const attribute = (key: string, html: string, type?: string): ProductPageContentAttribute => ({
  key,
  language: 'en-US',
  content: richContent(html, type),
});

function render(node: React.ReactNode, absent: string[] = []): string {
  return renderToString(
    <BlockRenderScope presence={{ absent }} language="en-US">
      {node}
    </BlockRenderScope>,
  );
}

describe('<ProductDescriptionPanel>', () => {
  it('server-renders the description, then every content attribute in the order received', () => {
    const html = render(
      <ProductDescriptionPanel
        text="A sturdy drill."
        content={[attribute('banner', '<p>Banner first</p>'), attribute('buying_guide', '<p>Guide second</p>')]}
      />,
    );
    const description = html.indexOf('A sturdy drill.');
    const banner = html.indexOf('Banner first');
    const guide = html.indexOf('Guide second');
    expect(description).toBeGreaterThanOrEqual(0);
    expect(banner).toBeGreaterThan(description);
    expect(guide).toBeGreaterThan(banner);
    expect(html).toContain('data-product-content="banner"');
    expect(html).toContain('data-product-content="buying_guide"');
  });

  it('prints no heading or label of its own above a document (FR-037)', () => {
    const html = render(<ProductDescriptionPanel text={null} content={[attribute('buying_guide', '<p>Body</p>')]} />);
    expect(html).not.toMatch(/<h[1-6][^>]*>/);
    expect(html).not.toContain('buying_guide<');
    expect(html).not.toContain('Buying guide');
  });

  it('renders the content alone when there is no description', () => {
    const html = render(<ProductDescriptionPanel text={null} content={[attribute('buying_guide', '<p>Only content</p>')]} />);
    expect(html).toContain('Only content');
    expect(html).not.toContain('whitespace-pre-line');
  });

  it('draws the same content whichever variant is selected: it is the product’s, not a variant’s', () => {
    const content = [attribute('buying_guide', '<p>Product level</p>')];
    // The panel takes no variant: the page hands it the product's content
    // whatever `?variant=` names.
    const first = render(<ProductDescriptionPanel text="Drill." content={content} />);
    const second = render(<ProductDescriptionPanel text="Drill." content={content} />);
    expect(second).toBe(first);
  });
});

describe('<ProductContent>', () => {
  it('sanitises authored HTML the way a CMS page does (FR-034)', () => {
    const html = render(
      <ProductContent
        attributeKey="buying_guide"
        language="en-US"
        content={richContent('<p onclick="steal()">Safe text</p><script>window.pwned = 1</script>')}
      />,
    );
    expect(html).toContain('Safe text');
    expect(html).not.toContain('window.pwned');
    expect(html).not.toContain('onclick');
  });

  it('draws no block of a switched-off module (FR-034)', () => {
    const html = render(
      <ProductContent attributeKey="buying_guide" language="en-US" content={richContent('<p>Authored before</p>')} />,
      ['cms'],
    );
    expect(html).not.toContain('Authored before');
  });

  it('renders nothing at all for a document with no block', () => {
    expect(
      render(
        <ProductContent
          attributeKey="buying_guide"
          language="en-US"
          content={{ root: { props: {} }, content: [], zones: {} }}
        />,
      ),
    ).toBe('');
  });
});

describe('the "Opis" panel with the CMS off (feature 172, US5: FR-051)', () => {
  const product = {
    description: 'A sturdy drill.',
    contentAttributes: [attribute('buying_guide', '<p>Authored guide</p>'), attribute('banner', '<p>Banner</p>', 'Heading')],
    visibleAttributes: [],
    attachments: [],
  };

  it('server-renders the plain description and no content', () => {
    const plan = productTabPlan(product, { pageBuilderPresent: false, absentModuleIds: ['cms'] });
    const html = render(<ProductDescriptionPanel text={plan.description!.text} content={plan.description!.content} />, [
      'cms',
    ]);
    expect(html).toContain('A sturdy drill.');
    expect(html).not.toContain('Authored guide');
    expect(html).not.toContain('Banner');
    expect(html).not.toContain('data-product-content');
  });

  it('renders the same description as with the CMS on', () => {
    const off = productTabPlan(product, { pageBuilderPresent: false, absentModuleIds: ['cms'] });
    const on = productTabPlan({ ...product, contentAttributes: [] }, { pageBuilderPresent: true, absentModuleIds: [] });
    expect(render(<ProductDescriptionPanel text={off.description!.text} content={off.description!.content} />)).toBe(
      render(<ProductDescriptionPanel text={on.description!.text} content={on.description!.content} />),
    );
  });
});

