import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import {
  BlockRenderEnvironmentProvider,
  DocumentSampleProvider,
} from '@endora-commerce/page-builder-core/contributions';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import quoteRequestsEn from '../../../../packages/modules/quote_requests/i18n/en.json';
import quoteRequestsPl from '../../../../packages/modules/quote_requests/i18n/pl.json';
import { sampleQuoteRequestData } from '../../../../packages/modules/quote_requests/src/backend/document/sample';

/**
 * Issue #902 — the quote template editor's canvas draws a label the template
 * leaves out the way the PDF prints it: in the language of the tree being
 * edited, not in the administrator's. A label the operator typed shows as
 * typed.
 *
 * The edited tree's language reaches a block through the render environment
 * the document-template editor provides around its canvas (issue #888). When
 * it is not the administrator's language, the canvas reads that language's
 * bundle itself.
 */

const getBundles = vi.fn();
vi.mock('@endora-commerce/admin-kit/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@endora-commerce/admin-kit/i18n')>()),
  getBundles: (language: string) => getBundles(language),
}));

const { quoteDocumentCanvas } = await import(
  '../../../../packages/modules/quote_requests/src/admin/document-blocks/canvas'
);

const EN = { quote_requests: quoteRequestsEn as Record<string, string> };
const PL = { quote_requests: quoteRequestsPl as Record<string, string> };

function draw(
  name: string,
  props: Record<string, unknown>,
  options: { tree: string; admin: 'en' | 'pl' },
): HTMLElement {
  const component = quoteDocumentCanvas.components![name] as unknown as {
    render: (props: Record<string, unknown>) => ReactElement;
  };
  const Render = component.render;
  return renderWithI18n(
    <BlockRenderEnvironmentProvider value={{ language: options.tree, preview: true }}>
      <DocumentSampleProvider value={sampleQuoteRequestData(options.tree === 'pl-PL' ? 'pl-PL' : 'en-US')}>
        <Render {...props} />
      </DocumentSampleProvider>
    </BlockRenderEnvironmentProvider>,
    options.admin === 'pl' ? PL : EN,
    { language: options.admin },
  ).container;
}

describe('quote canvas labels follow the edited tree (issue #902)', () => {
  beforeEach(() => {
    getBundles.mockReset();
    getBundles.mockImplementation((language: string) =>
      Promise.resolve({ language, bundles: language === 'pl' ? PL : EN }),
    );
  });

  it('a Polish tree draws empty labels in Polish for an English administrator', async () => {
    draw('quote_requests.QuoteHeader', {}, { tree: 'pl-PL', admin: 'en' });
    await waitFor(() => expect(screen.getByText('Oferta')).toBeTruthy());
    expect(screen.getByText(/^Numer oferty: /)).toBeTruthy();
    expect(screen.getByText(/^Ważna do: /)).toBeTruthy();
    expect(screen.queryByText('Quote')).toBeNull();
    expect(getBundles).toHaveBeenCalledWith('pl');
  });

  it('the parties, notes and details draw the Polish tree in Polish for an English administrator', async () => {
    draw('quote_requests.QuoteParties', {}, { tree: 'pl-PL', admin: 'en' });
    await waitFor(() => expect(screen.getByText('Nabywca')).toBeTruthy());
    expect(screen.getByText('Osoba kontaktowa')).toBeTruthy();
    draw('quote_requests.QuoteNotes', { showWhenEmpty: true }, { tree: 'pl-PL', admin: 'en' });
    await waitFor(() => expect(screen.getByText('Uwagi')).toBeTruthy());
    draw('quote_requests.QuoteDetails', {}, { tree: 'pl-PL', admin: 'en' });
    await waitFor(() => expect(screen.getByText('Szczegóły')).toBeTruthy());
  });

  it('a Polish tree draws empty labels in Polish for a Polish administrator, from the loaded bundle', () => {
    draw('quote_requests.QuoteHeader', {}, { tree: 'pl-PL', admin: 'pl' });
    expect(screen.getByText('Oferta')).toBeTruthy();
    expect(getBundles).not.toHaveBeenCalled();
  });

  it('a label the operator typed is drawn as typed', async () => {
    draw('quote_requests.QuoteHeader', { title: 'Propozycja' }, { tree: 'pl-PL', admin: 'en' });
    await waitFor(() => expect(screen.getByText(/^Numer oferty: /)).toBeTruthy());
    expect(screen.getByText('Propozycja')).toBeTruthy();
  });
});
