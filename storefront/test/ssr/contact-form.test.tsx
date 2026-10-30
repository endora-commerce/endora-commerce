import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { CmsRenderProvider } from '@endora-commerce/cms-components/components/render-context';
import { BlockRenderScope } from '../../components/BlockRenderScope';
import { PageBuilderRender } from '../../components/PageBuilderRender';
import { cmsRenderLocation } from '../../lib/page-builder/render-location';
import { cmsContactFormText } from '../../lib/page-builder/contact-form-text';

/**
 * `cms.ContactForm` on a storefront page (`specs/169-page-builder-contact-form/` T115, US6,
 * FR-015, FR-020): the form is in the server HTML and posts to the page language's
 * `/forms/contact`; a Polish page reads Polish defaults; the outcome on the URL is shown without
 * JavaScript; and no recipient address reaches the page — the block has no such prop, so even a
 * stored value under that name renders nowhere.
 */

const DOCUMENT = {
  root: { props: {} },
  content: [
    {
      type: 'cms.Section',
      props: {
        id: 'section-contact',
        anchor: 'write-to-us',
        content: [
          {
            type: 'cms.ContactForm',
            props: {
              id: 'contact',
              fields: { phone: { show: true } },
              // Not a prop of the block: recipients are a server-side setting.
              recipients: ['inbox@example.com'],
            },
          },
        ],
      },
    },
  ],
  zones: {},
};

function ssr(language: string, query: Record<string, string> = {}, absent: readonly string[] = []): string {
  const prefix = language.startsWith('pl') ? '/pl' : '';
  return renderToString(
    <BlockRenderScope presence={{ absent: [...absent] }} language={language}>
      <CmsRenderProvider
        embeds={{ blocks: {}, templates: {} }}
        location={cmsRenderLocation('/kontakt', query)}
        contactFormText={cmsContactFormText(language)}
        localizePath={(path) => `${prefix}${path}`}
      >
        <PageBuilderRender data={DOCUMENT} />
      </CmsRenderProvider>
    </BlockRenderScope>,
  );
}

describe('cms.ContactForm on a storefront page (T115)', () => {
  it('renders the form in the server HTML, posting to the page language’s handler', () => {
    const html = ssr('pl-PL');
    expect(html).toContain('action="/pl/forms/contact"');
    expect(html).toContain('name="returnTo" value="/pl/kontakt"');
    expect(html).toContain('name="anchor" value="write-to-us"');
    expect(html).toContain('name="form" value="contact"');
    expect(html).toMatch(/<input[^>]*name="phone"/);
  });

  it('reads Polish defaults on a Polish page and English on an English one', () => {
    const pl = ssr('pl-PL');
    expect(pl).toContain('aria-label="Formularz kontaktowy"');
    expect(pl).toContain('Imię i nazwisko');
    expect(pl).toContain('Wiadomość');
    expect(pl).toContain('>Wyślij<');
    expect(pl).not.toContain('>Send<');
    const en = ssr('en-US');
    expect(en).toContain('>Send<');
  });

  it('shows the outcome on the URL without JavaScript', () => {
    expect(ssr('pl-PL', { contact: 'sent', form: 'contact' })).toContain('Dziękujemy. Twoja wiadomość została wysłana.');
  });

  it('carries no recipient address', () => {
    expect(ssr('pl-PL')).not.toContain('inbox@example.com');
    expect(ssr('en-US')).not.toContain('inbox@example.com');
  });

  it('renders nothing while cms is absent', () => {
    const html = ssr('en-US', {}, ['cms']);
    expect(html).not.toContain('/forms/contact');
  });

  it('CmsPageRenderer hands the page language’s words to the render context', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/CmsPageRenderer.tsx'), 'utf8');
    expect(source).toMatch(/contactFormText=\{cmsContactFormText\(page\.language\)\}/);
  });
});
