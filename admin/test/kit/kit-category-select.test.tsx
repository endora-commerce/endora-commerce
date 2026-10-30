import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { AppLanguageContext } from '../../../packages/admin-shell/src/i18n/app-language-context';
import type { SupportedAdminLanguage } from '../../../packages/admin-shell/src/i18n/types';
import { renderWithI18n } from '../helpers/render-with-i18n';

/**
 * Issue #89 — `CategorySelect` has a test.
 *
 * The picker loads the whole category list once on mount from
 * `GET /api/v1/admin/catalog/categories` and filters it client-side. What is
 * asserted is that request and the four states an operator can see in its
 * listbox: the list loading, no categories, categories, and a failed request.
 *
 * The mock keys on `@endora-commerce/admin-kit/lib`, the barrel the component
 * imports `apiClient` from; `admin/test/setup.ts` makes `fetch` throw, so a
 * component that bypassed the barrel would fail every test here loudly.
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

const { CategorySelect } = await import('@endora-commerce/admin-kit/components');
const { ApiError } = await import('@endora-commerce/admin-kit/lib');

afterEach(() => {
  getSpy.mockReset();
});

const CATEGORIES = [
  { id: 'cat-1', slug: 'chairs', parentCategoryId: null, name: { 'en-US': 'Chairs', 'pl-PL': 'Krzesła' } },
  { id: 'cat-2', slug: 'desks', parentCategoryId: null, name: { 'pl-PL': 'Biurka' } },
  { id: 'cat-3', slug: 'misc', parentCategoryId: null, name: {} },
];

function renderSelect(
  ui: ReactElement,
  language: SupportedAdminLanguage = 'en',
): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    <AppLanguageContext.Provider value={{ language, setLanguage: (): void => {} }}>
      {ui}
    </AppLanguageContext.Provider>,
  );
}

async function open(): Promise<HTMLElement> {
  await userEvent.setup().click(screen.getByRole('combobox', { name: 'Select category' }));
  return screen.getByRole('listbox');
}

describe('CategorySelect', () => {
  it('fetches the category list once and shows a loading row until it arrives', async () => {
    let resolve: (v: unknown) => void = () => {};
    getSpy.mockReturnValue(new Promise((r) => (resolve = r)));
    renderSelect(<CategorySelect value={null} onChange={vi.fn()} />);

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/categories');
    expect((await open()).textContent).toContain('Loading…');

    resolve({ data: [] });
    await waitFor(() => expect(screen.getByRole('listbox').textContent).toContain('No categories.'));
  });

  it('says so when there are no categories', async () => {
    getSpy.mockResolvedValue({ data: [] });
    renderSelect(<CategorySelect value={null} onChange={vi.fn()} />);

    const listbox = await open();
    await waitFor(() => expect(listbox.textContent).toContain('No categories.'));
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('lists the categories with their slug and commits the id', async () => {
    getSpy.mockResolvedValue({ data: CATEGORIES });
    const onChange = vi.fn();
    renderSelect(<CategorySelect value={null} onChange={onChange} />);

    await open();
    const options = await screen.findAllByRole('option');
    // English name; a category with no English name shows the one it has; a
    // category with no name at all shows its slug.
    expect(options.map((o) => o.textContent)).toEqual(['Chairschairs', 'Biurkadesks', 'miscmisc']);

    await userEvent.setup().click(options[0]!);
    expect(onChange).toHaveBeenCalledWith('cat-1');
  });

  it('labels the categories in the admin language', async () => {
    // Category names are keyed by locale (`pl-PL`), the admin language by its
    // short code (`pl`). Indexing one by the other matched nothing, so a
    // Polish admin saw every category in English.
    getSpy.mockResolvedValue({ data: CATEGORIES });
    renderSelect(<CategorySelect value={null} onChange={vi.fn()} />, 'pl');

    await open();
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Krzesłachairs', 'Biurkadesks', 'miscmisc']);
  });

  it('shows the server message when the list fails to load', async () => {
    getSpy.mockRejectedValue(
      new ApiError(500, { error: { code: 'INTERNAL', message: 'Categories are unavailable.' } }),
    );
    renderSelect(<CategorySelect value={null} onChange={vi.fn()} />);

    const listbox = await open();
    await waitFor(() => expect(listbox.textContent).toContain('Categories are unavailable.'));
    expect(listbox.textContent).not.toContain('No categories.');
  });

  it('does not let a caller-supplied empty message hide a failed load', async () => {
    getSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    renderSelect(
      <CategorySelect value={null} onChange={vi.fn()} emptyMessage="Create a category first." />,
    );

    const listbox = await open();
    await waitFor(() => expect(listbox.textContent).toContain('Failed to load categories.'));
    expect(listbox.textContent).not.toContain('Create a category first.');
  });
});
