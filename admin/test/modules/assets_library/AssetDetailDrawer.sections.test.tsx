import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { ASSET_ID, detail, en, mockClient, renderDrawer } from './drawer-fixtures';

/**
 * Issue #1437 (UX audit 2026-11-17, DS-03) — the asset drawer is one card whose
 * body is titled `EditorSection`s (links, details, the file and its previous
 * version, where it is used), not a run of blocks each fenced off with a
 * hand-drawn top border and a heading of its own size. Sections are `h3` under
 * the drawer's `h2` card title (WCAG 2.2 SC 1.3.1), and none draws a frame.
 */

installOffsetParentShim();

const client = vi.hoisted(() => ({ current: null as ReturnType<typeof mockClient> | null }));
vi.mock('../../../../packages/modules/assets_library/src/admin/api/assets-library-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    assetsLibraryClient: new Proxy({}, { get: (_t, prop: string) => (client.current as unknown as Record<string, unknown>)[prop] }),
  };
});

const { AssetDetailDrawer } = await import('../../../../packages/modules/assets_library/src/admin/components/AssetDetailDrawer');

const PREVIOUS = {
  filename: 'certificate-2025.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  contentVersion: '0f1e2d3c4b5a',
  replacedAt: '2026-10-10T08:00:00.000Z',
  replacedBy: null,
  restorableUntil: '2026-11-09T08:00:00.000Z',
};

function framed(element: Element): boolean {
  return /(^|\s)border(\s|$)/.test(element.className) && /\brounded/.test(element.className);
}

beforeEach(() => {
  client.current = mockClient();
});

describe('AssetDetailDrawer — titled sections inside the one card (DS-03)', () => {
  it('groups the drawer into h3 sections in a fixed order, with the previous version inside the file section', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ previousVersion: PREVIOUS }));
    const { container } = renderDrawer(
      <AssetDetailDrawer assetId={ASSET_ID} onChanged={vi.fn()} onClose={vi.fn()} />,
      ['assets.read', 'assets.write'],
    );
    await screen.findByRole('region', { name: en('detail.section.links') });
    const card = container.querySelector('[data-slot="card"]')!;
    const outer = [...card.querySelectorAll<HTMLElement>('[data-slot="editor-section"]')].filter(
      (section) => section.parentElement?.closest('[data-slot="editor-section"]') == null,
    );
    expect(outer.map((section) => section.querySelector('h3')?.textContent)).toEqual([
      en('detail.section.links'),
      en('detail.section.details'),
      en('detail.section.file'),
      en('detail.referencedBy'),
    ]);
    for (const section of outer) expect(framed(section)).toBe(false);
    // The card is the only frame: no card in the card.
    expect(card.querySelectorAll('[data-slot="card"]')).toHaveLength(0);

    const links = screen.getByRole('region', { name: en('detail.section.links') });
    expect(within(links).getByLabelText(en('detail.shareUrl.label'))).toBeTruthy();
    expect(within(links).getByLabelText(en('detail.permalink.label'))).toBeTruthy();

    const file = screen.getByRole('region', { name: en('detail.section.file') });
    const previous = within(file).getByRole('region', { name: en('detail.previous.title') });
    expect(previous.querySelector('h4')?.textContent).toBe(en('detail.previous.title'));
  });

  it('says an unreferenced asset is not used, inside the referenced-by section', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    renderDrawer(<AssetDetailDrawer assetId={ASSET_ID} onChanged={vi.fn()} onClose={vi.fn()} />, ['assets.read']);
    const used = await screen.findByRole('region', { name: en('detail.referencedBy') });
    expect(within(used).getByText(en('detail.notReferenced'))).toBeTruthy();
  });
});
