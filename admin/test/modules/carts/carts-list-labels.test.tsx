import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { setMobileViewport } from '../../setup';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1368 — the carts list printed the raw cart status and approval status
 * codes as its filter options and in its status badges, and none of the
 * screen's own keys was in the carts catalogue, so the operator read
 * `carts.carts.page.title` in both languages.
 *
 * Rendered against the shipped catalogues in `en` and `pl`. The Polish run uses
 * Polish as its own fallback (`renderWithI18n`), so a key missing from `pl.json`
 * shows up as a raw key instead of hiding behind English.
 */
const getSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const { contributions } = await import('@endora-commerce/mod-carts/admin');
const CartsList = (await contributions.routes![0]!.component()).default as () => ReactNode;

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const CATALOGUES = {
  en: { core: read('../packages/modules/_i18n/i18n/en.json'), carts: read('../packages/modules/carts/i18n/en.json') },
  pl: { core: read('../packages/modules/_i18n/i18n/pl.json'), carts: read('../packages/modules/carts/i18n/pl.json') },
};

const STATUSES = ['active', 'abandoned', 'completed', 'rejected'];
const APPROVAL_STATUSES = ['not_required', 'pending', 'approved', 'rejected_by_org_admin'];

const ROW = {
  id: '00000000-0000-4000-8000-0000000000c1',
  ownerCustomerAccountId: '00000000-0000-4000-8000-000000000a01',
  ownerDisplayName: 'buyer@example.com',
  organizationId: null,
  organizationDisplayName: null,
  salesChannelCode: null,
  status: 'abandoned',
  approvalStatus: 'rejected_by_org_admin',
  itemCount: 3,
  total: { amount: 124.5, currency: 'PLN' },
  appliedPromotionCode: null,
  lastActivityAt: '2026-05-22T12:00:00Z',
  createdAt: '2026-05-22T11:00:00Z',
};

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  getSpy.mockResolvedValue({ data: [ROW], meta: { page: 1, pageSize: 20, totalCount: 1 } });
});
afterEach(() => cleanup());

describe.each(['en', 'pl'] as const)('Carts list labels (%s) — issue #1368', (language) => {
  const { carts: own } = CATALOGUES[language];

  function renderList(): void {
    renderWithI18n(
      withSession(
        <MemoryRouter>
          <CartsList />
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }) },
      ),
      CATALOGUES[language],
      { language },
    );
  }

  it('labels both filters\' options from the carts catalogue', async () => {
    renderList();
    await screen.findByText('buyer@example.com');

    const status = screen.getByLabelText(own['carts.column.status']!);
    expect(within(status).getAllByRole('option').map((o) => o.textContent)).toEqual([
      own['carts.filter.all'],
      ...STATUSES.map((s) => own[`carts.status.${s}`]),
    ]);

    const approval = screen.getByLabelText(own['carts.column.approval']!);
    expect(within(approval).getAllByRole('option').map((o) => o.textContent)).toEqual([
      own['carts.filter.all'],
      ...APPROVAL_STATUSES.map((s) => own[`carts.approvalStatus.${s}`]),
    ]);
  });

  it('labels the status and approval badges from the carts catalogue', async () => {
    renderList();
    await screen.findByText('buyer@example.com');
    const table = screen.getByRole('table');
    expect(within(table).getByText(own['carts.status.abandoned']!)).toBeInTheDocument();
    expect(within(table).getByText(own['carts.approvalStatus.rejected_by_org_admin']!)).toBeInTheDocument();
  });

  it('shows no raw catalogue key and no status code anywhere on the screen', async () => {
    renderList();
    await screen.findByText('buyer@example.com');
    const container = document.body;
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\bcarts\.[a-z]/);
    expect(text).not.toMatch(/\bcore\.[a-z]/);
    for (const code of [...STATUSES, ...APPROVAL_STATUSES]) {
      const shown = [...container.querySelectorAll('option, td *, td')].filter(
        (node) => node.childElementCount === 0 && node.textContent?.trim() === code,
      );
      expect(shown, `raw code "${code}" on screen`).toEqual([]);
    }
  });
});
