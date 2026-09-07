import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { AppLanguageContext } from '../../../packages/admin-shell/src/i18n/app-language-context';
import { renderWithI18n } from '../helpers/render-with-i18n';

/**
 * The three data-fetching pickers build their **own** requests (feature 091, P2).
 *
 * Before P2 each of them imported another module's admin API client —
 * `salesChannelsClient`, `cmsClient`, `organizationsPickerClient` — which is
 * why `backend/scripts/ledgers/cross-module-imports/host.ts` carried seven keys
 * for four files and why `admin-kit-surface.md` R6 refused to publish them: a
 * kit component that imports module code puts module knowledge in the kit.
 *
 * The exit P2 takes is the one batches three and five took for a module screen:
 * the caller rebuilds the request from the published `apiClient` and the
 * owner's **contract** types. So these tests assert the request, not a client
 * call — there is no client left to spy on, and the URL is now the whole of
 * what the picker knows about the module whose data it shows.
 *
 * The mock is keyed on `@endora-commerce/admin-kit/lib`, the barrel the moved
 * components import `apiClient` from. That is deliberate and is the seam every
 * packaged screen's test already uses (`admin/test/modules/carts/CartsList.test.tsx`
 * says so in its own comment): `vi.mock` keys on a resolved module id, and a
 * component importing `../../lib/api-client.js` from inside the package would
 * resolve to a module this mock does not name.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { CmsBlockPicker, CmsPagePicker, SalesChannelPicker } = await import(
  '@endora-commerce/admin-kit/components'
);

/**
 * `<Combobox>` calls `useTranslation`, so every picker needs the translation
 * provider; `SalesChannelPicker` additionally reads the admin language, which is
 * a context with no fallback — `useAppLanguage` throws rather than defaulting.
 */
function withLanguage(ui: ReactElement): ReactElement {
  const node = ((): ReactNode => ui)();
  return (
    <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
      <>{node}</>
    </AppLanguageContext.Provider>
  );
}

beforeEach(() => {
  getSpy.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SalesChannelPicker', () => {
  it('asks the sales-channels list endpoint itself, with the picker page size', async () => {
    getSpy.mockResolvedValue({
      items: [
        {
          id: 'ch-1',
          code: 'web',
          name: { 'en-US': 'Web store', 'pl-PL': 'Sklep' },
          active: true,
        },
      ],
      page: 1,
      pageSize: 200,
      total: 1,
    });

    const user = userEvent.setup();
    renderWithI18n(withLanguage(<SalesChannelPicker value={null} onChange={vi.fn()} />));

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/sales-channels?pageSize=200&activeOnly=false');
    });

    await user.click(screen.getByRole('combobox'));
    await waitFor(() => {
      expect(screen.getByText('Web store')).toBeDefined();
    });
  });

  it('narrows to the active channels when asked', async () => {
    getSpy.mockResolvedValue({ items: [], page: 1, pageSize: 200, total: 0 });
    renderWithI18n(withLanguage(<SalesChannelPicker value={null} onChange={vi.fn()} activeOnly />));
    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/sales-channels?pageSize=200&activeOnly=true');
    });
  });
});

describe('CmsBlockPicker', () => {
  it('asks the CMS blocks endpoint itself', async () => {
    getSpy.mockResolvedValue({
      data: [{ id: 'blk-1', code: 'promo', name: 'Promo banner' }],
      nextCursor: null,
    });

    const user = userEvent.setup();
    renderWithI18n(<CmsBlockPicker value={null} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/cms/blocks');
    });

    await user.click(screen.getByRole('combobox'));
    await waitFor(() => {
      expect(screen.getByText('Promo banner')).toBeDefined();
    });
  });
});

describe('CmsPagePicker', () => {
  it('asks the CMS pages endpoint itself, carrying the typed query', async () => {
    getSpy.mockResolvedValue({
      data: [{ id: 'pg-1', slug: 'about', name: 'About us', status: 'published' }],
      nextCursor: null,
    });

    const user = userEvent.setup();
    renderWithI18n(<CmsPagePicker value={null} onChange={vi.fn()} />);

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'abo');

    await waitFor(() => {
      const last = getSpy.mock.calls.at(-1)?.[0] as string | undefined;
      expect(last).toBe('/api/v1/admin/cms/pages?q=abo&limit=20');
    });

    await waitFor(() => {
      expect(screen.getByText('About us')).toBeDefined();
    });
  });
});
