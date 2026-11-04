import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { GallerySwitcher } from '../../components/GallerySwitcher';
import { AttachmentsList } from '../../components/AttachmentsList';

/**
 * Feature 172 (`specs/172-product-editor-scope-switcher/` T061; FR-013, FR-030, round 6) — the
 * product page renders the texts `catalog` resolved at the request's (channel, language) as they
 * come. The one rule the page itself owns is the image alt text:
 *
 * - an own alt text at the scope → that text;
 * - **an empty alt override** (`altText: ''`) → literally `alt=""`, a decorative image — never
 *   the product name and never the asset library's own alt text;
 * - no alt text anywhere (`null` / absent) → the product name, as before.
 */

type GalleryItem = Parameters<typeof GallerySwitcher>[0]['gallery'][number];
const image = (altText: string | null | undefined): GalleryItem => ({
  id: 'g1',
  position: 0,
  labels: ['base_image'],
  asset: { id: 'a1', kind: 'image', url: '/asset/drill.jpg' },
  ...(altText === undefined ? {} : { altText }),
});
const render = (altText: string | null | undefined): string =>
  renderToString(<GallerySwitcher gallery={[image(altText)]} alt="Wiertarka X Pro" locale="pl-PL" />);
const altsOf = (html: string): string[] => [...html.matchAll(/<img[^>]*\balt="([^"]*)"/g)].map((m) => m[1]!);

describe('PDP texts at (C, L) — gallery alt text', () => {
  it('renders the alt text resolved at the scope', () => {
    const alts = altsOf(render('Wiertarka udarowa, widok z boku'));
    expect(alts.length).toBeGreaterThan(0);
    expect(new Set(alts)).toEqual(new Set(['Wiertarka udarowa, widok z boku']));
  });

  it('renders alt="" for an empty alt override (decorative image), not the product name', () => {
    const alts = altsOf(render(''));
    expect(alts.length).toBeGreaterThan(0);
    expect(new Set(alts)).toEqual(new Set(['']));
  });

  it('falls back to the product name when the image has no alt text anywhere', () => {
    expect(new Set(altsOf(render(null)))).toEqual(new Set(['Wiertarka X Pro']));
    expect(new Set(altsOf(render(undefined)))).toEqual(new Set(['Wiertarka X Pro']));
  });
});

describe('PDP texts at (C, L) — attachments', () => {
  it("renders the attachment's name and description as resolved at the scope, and no description for an empty one", () => {
    const html = renderToString(
      <AttachmentsList
        locale="pl-PL"
        attachments={[
          {
            id: '1',
            position: 0,
            name: 'Instrukcja (PL)',
            description: null,
            type: { id: 't', code: 'manual', name: { 'pl-PL': 'Instrukcja' } },
            asset: { id: 'as1', kind: 'pdf', url: '/files/m.pdf', filename: 'm.pdf', sizeBytes: 1, mimeType: 'application/pdf' },
          },
        ]}
      />,
    );
    expect(html).toContain('Instrukcja (PL)');
  });
});
