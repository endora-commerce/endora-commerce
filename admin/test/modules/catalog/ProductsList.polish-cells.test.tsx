import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Issue #501, item 4 — with the admin in Polish the product list's Type,
 * Visibility and Updated cells stayed English ("Simple", "Public", "39m ago"),
 * and so did the Type chip's value. They render through the catalog bundle now,
 * in the admin's language. The real Polish bundle is mounted, so a key missing
 * from it shows up here as a raw key rather than as a pass.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    PAGE_SIZE_OPTIONS: [5, 10, 20, 50, 100, 500] as const,
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
  };
});

const { ProductsList } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductsList');

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogBundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(
    readFileSync(resolve(__dirname, `../../../../packages/modules/catalog/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;

const MINUTE = 60_000;
const OLD = '2026-05-15T10:00:00.000Z';
const row = (id: string, name: string, extra: Record<string, unknown>): unknown => ({
  id,
  sku: `SKU-${name}`,
  slug: name.toLowerCase(),
  type: 'simple',
  status: 'active',
  name,
  visibility: 'public',
  attributeValues: {},
  updatedAt: OLD,
  ...extra,
});

beforeEach(() => {
  const now = Date.now();
  getSpy.mockReset();
  getSpy.mockImplementation(async (path: string) =>
    path.startsWith('/api/v1/admin/catalog/products/list-views')
      ? { data: [] }
      : {
          data: [
            row('00000000-0000-4000-8000-0000000000e1', 'Alpha', {
              updatedAt: new Date(now - 39 * MINUTE - 5_000).toISOString(),
            }),
            row('00000000-0000-4000-8000-0000000000e2', 'Beta', {
              type: 'configurable',
              visibility: 'logged_in_only',
              updatedAt: new Date(now - 5 * 60 * MINUTE).toISOString(),
            }),
            row('00000000-0000-4000-8000-0000000000e3', 'Gamma', {
              visibility: 'organization_restricted',
              updatedAt: new Date(now - 3 * 24 * 60 * MINUTE).toISOString(),
            }),
            row('00000000-0000-4000-8000-0000000000e4', 'Delta', {}),
            row('00000000-0000-4000-8000-0000000000e5', 'Epsilon', {
              updatedAt: new Date(now - 10_000).toISOString(),
            }),
          ],
          pagination: { page: 0, pageSize: 20, total: 5 },
          counts: { all: 5, active: 5, inactive: 0, archived: 0 },
        },
  );
});
afterEach(() => vi.clearAllMocks());

function renderList(language: 'en' | 'pl'): void {
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <ProductsList />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }) },
    ),
    { catalog: catalogBundle(language) },
    { language },
  );
}

async function rowOf(name: string): Promise<HTMLElement> {
  const cell = await screen.findByText(name);
  return cell.closest('tr') as HTMLElement;
}

describe('ProductsList cells speak the admin language (issue #501)', () => {
  it('renders type, visibility and the updated time in Polish', async () => {
    renderList('pl');
    const alpha = await rowOf('Alpha');
    expect(within(alpha).getByText('Prosty')).toBeTruthy();
    expect(within(alpha).getByText('Wszyscy kupujący')).toBeTruthy();
    expect(within(alpha).getByText('39 min temu')).toBeTruthy();

    const beta = await rowOf('Beta');
    expect(within(beta).getByText('Konfigurowalny')).toBeTruthy();
    expect(within(beta).getByText('Tylko zalogowani kupujący')).toBeTruthy();
    expect(within(beta).getByText('5 godz. temu')).toBeTruthy();

    const gamma = await rowOf('Gamma');
    expect(within(gamma).getByText('Wybrane organizacje')).toBeTruthy();
    expect(within(gamma).getByText('3 dni temu')).toBeTruthy();

    const delta = await rowOf('Delta');
    const date = new Date(OLD).toLocaleDateString('pl-PL', { month: 'short', day: 'numeric' });
    expect(within(delta).getByText(date)).toBeTruthy();

    const epsilon = await rowOf('Epsilon');
    expect(within(epsilon).getByText('przed chwilą')).toBeTruthy();

    const table = alpha.closest('table') as HTMLElement;
    for (const english of [/\bSimple\b/, /\bPublic\b/, /\bago\b/, /just now/, /Logged-in/, /Org-restricted/]) {
      expect(within(table).queryByText(english)).toBeNull();
    }
  });

  it('renders the Type chip value in Polish', async () => {
    renderList('pl');
    await rowOf('Alpha');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Rodzaj/ }));
    expect(await screen.findByRole('button', { name: /^Rodzaj: Prosty/ })).toBeTruthy();
  });

  it('keeps the English wording in English', async () => {
    renderList('en');
    const alpha = await rowOf('Alpha');
    expect(within(alpha).getByText('Simple')).toBeTruthy();
    expect(within(alpha).getByText('All buyers')).toBeTruthy();
    expect(within(alpha).getByText('39m ago')).toBeTruthy();
  });
});
