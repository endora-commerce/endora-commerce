import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import seoEn from '../../../../packages/modules/seo/i18n/en.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1499 (UX audit SALES-17, owner decision DEC-12 a) — a regenerated
 * sitemap was said in a success banner above the channel table. The row's
 * figures already change in place; the sentence is now said in the sitemap
 * card's header, in a region mounted before it has text.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { SeoPage } = await import('../../../../packages/modules/seo/src/admin/pages/SeoPage');

const ROW = {
  salesChannelCode: 'b2b',
  salesChannelName: 'B2B',
  storefrontUrl: 'https://shop.example',
  storefrontUrlSource: 'channel',
  generatedAt: null,
  urlCount: null,
  byteSize: null,
};

beforeEach(() => {
  getSpy.mockReset().mockImplementation((path: string) =>
    Promise.resolve({ data: path === '/api/v1/admin/seo/sitemap' ? [ROW] : [] }),
  );
  postSpy.mockReset().mockResolvedValue({
    data: { salesChannelCode: 'b2b', generatedAt: '2026-11-20T00:00:00.000Z', urlCount: 12, byteSize: 2048 },
  });
});

describe('SEO sitemap card — regeneration result (SALES-17)', () => {
  it('says the result in the card header, with no success banner', async () => {
    renderWithI18n(
      <MemoryRouter>{withSession(<SeoPage />, { session: adminSession({ permissions: ['catalog:read'] }) })}</MemoryRouter>,
      { seo: seoEn as Record<string, string>, core: coreEn as Record<string, string> },
    );
    const title = await screen.findByText(coreEn['seo.sitemap.title']);
    const region = within(title.parentElement!).getByRole('status');
    expect(region.textContent).toBe('');
    fireEvent.click(await screen.findByRole('button', { name: coreEn['seo.sitemap.regenerate'] }));
    await waitFor(() => expect(region.textContent).toContain('b2b'));
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();
  });
});
