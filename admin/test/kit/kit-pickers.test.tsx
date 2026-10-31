import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, type ReactElement, type ReactNode } from 'react';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { adminSession } from '../helpers/render-with-session';

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

const { CmsBlockPicker, CmsPagePicker, ProductPicker, SalesChannelPicker } = await import(
  '@endora-commerce/admin-kit/components'
);
const { AuthProvider } = await import('@endora-commerce/admin-kit/lib');

/**
 * `<Combobox>` calls `useTranslation`, so every picker needs the translation
 * provider; `SalesChannelPicker` additionally reads the admin language, which is
 * a context with no fallback — `useAppLanguage` throws rather than defaulting.
 */
function withLanguage(ui: ReactElement, language: 'en' | 'pl' = 'en'): ReactElement {
  const node = ((): ReactNode => ui)();
  return (
    <AppLanguageContext.Provider value={{ language, setLanguage: (): void => {} }}>
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

  it('labels the channels in the admin language (#562)', async () => {
    // Channel names are keyed by locale (`pl-PL`), the admin language by its
    // short code (`pl`); indexing one by the other matched nothing, so a Polish
    // admin saw every channel under its English name.
    getSpy.mockResolvedValue({
      items: [
        { id: 'ch-1', code: 'web', name: { 'en-US': 'Web store', 'pl-PL': 'Sklep' }, active: true },
        { id: 'ch-2', code: 'b2b', name: { 'en-US': 'Wholesale' }, active: true },
      ],
      page: 1,
      pageSize: 200,
      total: 2,
    });

    renderWithI18n(withLanguage(<SalesChannelPicker value={null} onChange={vi.fn()} />, 'pl'));
    await userEvent.setup().click(screen.getByRole('combobox'));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Sklepweb', 'Wholesaleb2b']);
  });

  it('speaks Polish to a Polish admin, and an inactive channel says so', async () => {
    getSpy.mockResolvedValue({
      items: [{ id: 'ch-3', code: 'old', name: { 'pl-PL': 'Stary sklep' }, active: false }],
      page: 1,
      pageSize: 200,
      total: 1,
    });
    renderWithI18n(
      withLanguage(<SalesChannelPicker value={null} onChange={vi.fn()} />, 'pl'),
      shippedCoreBundle('pl'),
      { language: 'pl' },
    );

    const input = screen.getByRole('combobox', { name: 'Wybierz kanał sprzedaży' });
    expect(input.getAttribute('placeholder')).toBe('Wybierz kanał sprzedaży…');
    await userEvent.setup().click(input);
    const [option] = await screen.findAllByRole('option');
    expect(option!.textContent).toBe('Stary sklepold · nieaktywny');
  });

  it('shows a failed load even when the caller passes an empty message', async () => {
    getSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    renderWithI18n(
      withLanguage(
        <SalesChannelPicker value={null} onChange={vi.fn()} emptyMessage="Create a channel first." />,
        'pl',
      ),
      shippedCoreBundle('pl'),
      { language: 'pl' },
    );

    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Wybierz kanał sprzedaży' }));
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toBe(
        'Nie udało się wczytać kanałów sprzedaży.',
      );
    });
  });

  it('reports a response with no channel list as a failed load, not a crash', async () => {
    // A body of another endpoint's shape (`{ data: [] }`) used to fail inside
    // the load's own `.then` and land in its `.catch`; holding `undefined` in
    // state instead throws at render, outside every handler.
    getSpy.mockResolvedValue({ data: [], meta: { limit: 20, nextCursor: null } });
    renderWithI18n(
      withLanguage(<SalesChannelPicker value={null} onChange={vi.fn()} />),
      shippedCoreBundle('en'),
    );

    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Select sales channel' }));
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toBe('Failed to load channels.');
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

/**
 * `ProductPicker`'s additive props (feature 145, research R-5, contract B12).
 *
 * The quick single-product search beside **Browse products** applies the same
 * `productSelectability` as the table, so a product a host refuses is shown and
 * disabled with its reason rather than hidden. The `catalog:read` gate is
 * **opt-in**: it applies only when the host passes `rules`, so the consumers that
 * pass none (`seo`'s `SeoPage`, `quote_requests`' `RfqDetail`, `catalog`'s
 * `ProductEditor`) keep exactly today's behaviour — the last case here renders
 * the picker with no `AuthProvider` at all, which a gate would throw on.
 */
describe('ProductPicker — rules, alreadyAddedIds, onPickProduct', () => {
  const REPO_ROOT = resolve(process.cwd(), '..');
  const CORE = {
    core: JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/modules/_i18n/i18n/en.json'), 'utf8'),
    ) as Record<string, string>,
  };

  const ROWS = [
    { id: 'p-group', sku: 'GRP-1', slug: 'grp', name: { 'en-US': 'Grouped set' }, status: 'active', type: 'grouped' },
    { id: 'p-off', sku: 'OFF-1', slug: 'off', name: { 'en-US': 'Paused widget' }, status: 'inactive', type: 'simple' },
    // Feature 163 (FR-019) — archived whatever its status: refused for being archived.
    {
      id: 'p-archived',
      sku: 'ARC-1',
      slug: 'arc',
      name: { 'en-US': 'Retired widget' },
      status: 'active',
      type: 'simple',
      archivedAt: '2026-10-20T00:00:00.000Z',
    },
    { id: 'p-added', sku: 'ADD-1', slug: 'add', name: { 'en-US': 'Added widget' }, status: 'active', type: 'simple' },
    { id: 'p-ok', sku: 'OK-1', slug: 'ok', name: { 'en-US': 'Plain widget', 'pl-PL': 'Zwykły widżet' }, status: 'active', type: 'simple' },
  ];

  const ORDER_RULES = {
    initialStatus: 'active' as const,
    blockedTypes: ['grouped', 'bundle'] as const,
    blockedStatuses: ['inactive'] as const,
    blockArchived: true,
  };

  function withSession(ui: ReactElement, permissions: readonly string[]): ReactElement {
    return <AuthProvider initial={adminSession({ permissions })}>{ui}</AuthProvider>;
  }

  it('renders refused products disabled with their translated reason, and hands over the full summary', async () => {
    getSpy.mockResolvedValue({ data: ROWS });
    const onChange = vi.fn();
    const onPickProduct = vi.fn();
    const user = userEvent.setup();
    renderWithI18n(
      withSession(
        <ProductPicker
          mode="select"
          value={null}
          onChange={onChange}
          includeArchived
          rules={ORDER_RULES}
          alreadyAddedIds={['p-added']}
          onPickProduct={onPickProduct}
        />,
        ['catalog:read'],
      ),
      CORE,
    );

    await user.click(screen.getByRole('combobox'));
    await waitFor(() => expect(screen.getByRole('option', { name: /Plain widget/ })).toBeDefined());

    const group = screen.getByRole('option', { name: /Grouped set/ });
    expect(group.getAttribute('aria-disabled')).toBe('true');
    expect(group.textContent).toContain('Product group — pick its individual products');
    const off = screen.getByRole('option', { name: /Paused widget/ });
    expect(off.getAttribute('aria-disabled')).toBe('true');
    expect(off.textContent).toContain('Not active — cannot be added');
    const archived = screen.getByRole('option', { name: /Retired widget/ });
    expect(archived.getAttribute('aria-disabled')).toBe('true');
    expect(archived.textContent).toContain('Archived — cannot be added');
    const added = screen.getByRole('option', { name: /Added widget/ });
    expect(added.getAttribute('aria-disabled')).toBe('true');
    expect(added.textContent).toContain('Already added');
    expect(screen.getByRole('option', { name: /Plain widget/ }).getAttribute('aria-disabled')).toBeNull();

    await user.click(group);
    expect(onPickProduct).not.toHaveBeenCalled();

    await user.click(screen.getByRole('option', { name: /Plain widget/ }));
    expect(onChange).toHaveBeenCalledWith('p-ok');
    expect(onPickProduct).toHaveBeenCalledWith({
      id: 'p-ok',
      sku: 'OK-1',
      slug: 'ok',
      name: { 'en-US': 'Plain widget', 'pl-PL': 'Zwykły widżet' },
      status: 'active',
      type: 'simple',
    });
  });

  it('a host that does not refuse archived products sees them selectable, labelled Archived beside the status', async () => {
    getSpy.mockResolvedValue({ data: ROWS });
    const user = userEvent.setup();
    renderWithI18n(
      withSession(
        <ProductPicker mode="select" value={null} onChange={vi.fn()} rules={{ initialStatus: 'all' }} />,
        ['catalog:read'],
      ),
      CORE,
    );
    await user.click(screen.getByRole('combobox'));
    const archived = await screen.findByRole('option', { name: /Retired widget/ });
    expect(archived.getAttribute('aria-disabled')).toBeNull();
    expect(archived.textContent).toContain('ARC-1 · Archived');
    expect(screen.getByRole('option', { name: /Paused widget/ }).textContent).toContain('OFF-1 · Inactive');
  });

  it('with rules and without catalog:read it is disabled with the hint', () => {
    renderWithI18n(
      withSession(
        <ProductPicker mode="select" value={null} onChange={vi.fn()} rules={ORDER_RULES} />,
        ['orders:write'],
      ),
      CORE,
    );
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    const hint = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('You need the catalog read permission to browse products.');
  });

  it('without the new props it behaves as before — no catalog:read gate, no session needed', async () => {
    getSpy.mockResolvedValue({ data: ROWS });
    const user = userEvent.setup();
    // No AuthProvider: an unconditional gate would throw here.
    renderWithI18n(<ProductPicker mode="select" value={null} onChange={vi.fn()} />, CORE);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.getAttribute('aria-describedby')).toBeNull();

    await user.click(input);
    await waitFor(() => expect(screen.getByRole('option', { name: /Grouped set/ })).toBeDefined());
    // Nothing is disabled, and the raw status suffix is today's.
    for (const option of screen.getAllByRole('option')) {
      expect(option.getAttribute('aria-disabled')).toBeNull();
    }
    expect(screen.getByRole('option', { name: /Paused widget/ }).textContent).toContain('OFF-1 · inactive');
    expect(getSpy.mock.calls.at(-1)?.[0]).toBe('/api/v1/admin/catalog/products?page=0&pageSize=20');
  });

  it('without rules a session lacking catalog:read changes nothing either', () => {
    renderWithI18n(
      withSession(<ProductPicker mode="select" value={null} onChange={vi.fn()} />, []),
      CORE,
    );
    expect((screen.getByRole('combobox') as HTMLInputElement).disabled).toBe(false);
  });
});

/**
 * Feature 146, T099 owner finding — a preselected product must show without any
 * interaction, under `<StrictMode>` as the admin runs it (`AdminRoot.tsx`).
 *
 * The warm-up effect used to mark an id as fetched before its answer arrived;
 * StrictMode's simulated unmount discarded that answer, and the remount saw
 * nothing missing — so the field stayed empty until the popup's search happened
 * to load the product.
 */
describe('ProductPicker — preselected value under StrictMode', () => {
  const PRODUCT = {
    id: 'p-kept',
    sku: 'KEPT-1',
    slug: 'kept',
    name: { 'en-US': 'Kept widget' },
    status: 'active',
    type: 'simple',
  };

  /**
   * Mounts `ui` inside `<StrictMode>` on an **update** of an already-mounted
   * tree — the way the Modify tab mounts its pickers when the tab is opened.
   * That is the commit on which StrictMode's simulated unmount/remount of the
   * picker's effects was observed to run; returns a re-render for the same tree.
   */
  function mountLater(ui: ReactElement): (next: ReactElement) => void {
    const { rerender } = renderWithI18n(<StrictMode>{null}</StrictMode>);
    const again = (next: ReactElement): void => rerender(<StrictMode>{next}</StrictMode>);
    again(ui);
    return again;
  }

  function answerById(): void {
    getSpy.mockImplementation((url: string) =>
      url === `/api/v1/admin/catalog/products/${PRODUCT.id}`
        ? Promise.resolve({ data: PRODUCT })
        : Promise.resolve({ data: [] }),
    );
  }

  it('select: shows the preselected product\'s name without opening the popup', async () => {
    answerById();
    mountLater(<ProductPicker mode="select" value={PRODUCT.id} onChange={vi.fn()} />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('Kept widget'));
    // The remount re-awaits the request in flight rather than firing another.
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('multiselect: shows the preselected chip\'s name and SKU without opening the popup', async () => {
    answerById();
    mountLater(<ProductPicker mode="multiselect" value={[PRODUCT.id]} onChange={vi.fn()} />);
    const chip = await screen.findByRole('listitem');
    await waitFor(() => expect(chip.textContent).toContain('Kept widget'));
    expect(chip.textContent).toContain('KEPT-1');
  });

  it('does not re-ask an id whose lookup failed on every re-render', async () => {
    getSpy.mockRejectedValue(new Error('gone'));
    const rerender = mountLater(
      <ProductPicker mode="select" value={PRODUCT.id} onChange={vi.fn()} />,
    );
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    const asked = getSpy.mock.calls.length;
    rerender(<ProductPicker mode="select" value={PRODUCT.id} onChange={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(getSpy.mock.calls.length).toBe(asked);
  });
});
