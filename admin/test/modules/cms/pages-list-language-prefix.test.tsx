import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CmsPageSummary } from '@endora-commerce/contracts';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';

/**
 * Feature 167 (US7, FR-041) — the CMS page list marks a page whose first slug segment
 * is a storefront language prefix of a sales channel, naming the prefix and the
 * channels, in the editor's language.
 */

const page = (over: Partial<CmsPageSummary>): CmsPageSummary => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Page',
  slug: 'page',
  status: 'published',
  active: true,
  description: null,
  salesChannelIds: [],
  languages: ['pl-PL'],
  version: 1,
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
  parentPageId: null,
  parentPathInUrl: false,
  translations: {},
  ...over,
});

vi.mock('../../../../packages/modules/cms/src/admin/api/cms-client', () => ({
  cmsClient: {
    listPages: async () => ({
      data: [
        page({ id: '00000000-0000-4000-8000-000000000002', name: 'German', slug: 'de', shadowedByLanguagePrefix: { prefix: 'de', channelCodes: ['b2b'] } }),
        page({ id: '00000000-0000-4000-8000-000000000003', name: 'About', slug: 'o-nas' }),
      ],
      nextCursor: null,
    }),
  },
}));

const { PagesListPage } = await import('../../../../packages/modules/cms/src/admin/pages/PagesListPage');

const bundlePath = resolve(process.cwd(), '../packages/modules/cms/i18n/en.json');
const en = JSON.parse(readFileSync(bundlePath, 'utf8')) as Record<string, string>;
const pl = JSON.parse(readFileSync(bundlePath.replace('en.json', 'pl.json'), 'utf8')) as Record<string, string>;

describe('CMS pages list — shadowed by a language prefix', () => {
  it('ships the badge and its explanation in English and Polish', () => {
    for (const key of ['pagesList.shadowedByLanguagePrefix', 'pagesList.shadowedByLanguagePrefixHint']) {
      expect(en[key], key).toBeTruthy();
      expect(pl[key], key).toBeTruthy();
    }
  });

  it('marks only the shadowed page', async () => {
    renderWithSession(
      <MemoryRouter>
        <PagesListPage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['cms'] }),
        bundle: { cms: en },
      },
    );
    await waitFor(() => expect(screen.getByText('German')).toBeTruthy());
    const badges = screen.getAllByText(en['pagesList.shadowedByLanguagePrefix']!.replace('{prefix}', 'de'));
    expect(badges).toHaveLength(1);
    expect(badges[0]!.getAttribute('title')).toContain('b2b');
  });
});

describe('CMS pages list — search box (#1465)', () => {
  it('names the search box by a label, not only by its placeholder', async () => {
    renderWithSession(
      <MemoryRouter>
        <PagesListPage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['cms'] }),
        bundle: { cms: en },
      },
    );
    expect(await screen.findByRole('searchbox', { name: en['pagesList.searchLabel']! })).toBeInTheDocument();
    expect(pl['pagesList.searchLabel']).toBeTruthy();
    expect(pl['pagesList.searchLabel']).not.toBe(en['pagesList.searchLabel']);
  });
});
