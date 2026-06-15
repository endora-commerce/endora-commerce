import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MobileSearchOverlay } from '../components/mobile/MobileSearchOverlay';

/**
 * Feature 044 / US5 — full-screen mobile search overlay.
 *
 * SSR proves the trigger renders as a search-box affordance and that the
 * full-screen overlay is closed on first paint. Opening, focusing, typing,
 * and the suggestion fetch are client effects exercised on a real device.
 */

describe('MobileSearchOverlay', () => {
  it('renders the search-box trigger with the placeholder', () => {
    const html = renderToString(
      <MobileSearchOverlay
        apiBaseUrl="http://api"
        locale="pl-PL"
        placeholder="Szukaj SKU, kodu, nazwy…"
        seeAllResultsLabel="Pokaż wszystkie wyniki"
        quickLinks={[{ label: 'Łożyska', href: '/c/lozyska' }]}
      />,
    );
    expect(html).toContain('industria-search');
    expect(html).toContain('Szukaj SKU, kodu, nazwy…');
  });

  it('keeps the full-screen overlay closed on initial render', () => {
    const html = renderToString(
      <MobileSearchOverlay
        apiBaseUrl="http://api"
        locale="pl-PL"
        placeholder="Szukaj"
        seeAllResultsLabel="Pokaż"
      />,
    );
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('Podpowiedzi');
    expect(html).not.toContain('m-search-overlay');
  });
});
