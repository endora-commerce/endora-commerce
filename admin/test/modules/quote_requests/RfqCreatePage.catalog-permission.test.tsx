import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 145 QA — FR-013 at the host: the trigger and picker gates are proved on the shared
 * components; this proves **Create quote request** mounts both, so an operator with
 * `quote_requests:write` but not `catalog:read` is told why instead of getting live controls.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => getSpy(...a),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

const { RfqCreatePage } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqCreatePage');

const CORE: Record<string, string> = JSON.parse(
  readFileSync(join(resolve(process.cwd(), '..'), 'packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const BUNDLE: Bundle = { core: CORE };

beforeEach(() => {
  getSpy.mockReset();
  window.localStorage.clear();
  getSpy.mockResolvedValue({ data: [] });
});

function renderPage(permissions: string[]): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/quote-requests/new']}>
        <RfqCreatePage />
      </MemoryRouter>,
      { session: adminSession({ permissions }), presence: modulePresence({ present: ['quote_requests'] }) },
    ),
    BUNDLE,
  );
}

describe('RfqCreatePage — product picking permission (FR-013)', () => {
  it('disables Browse products and the quick search, each with the permission hint, without catalog:read', async () => {
    renderPage(['quote_requests:write', 'customers:read']);

    const browse = await screen.findByRole('button', { name: CORE['productBrowser.trigger']! });
    expect(browse).toBeDisabled();
    expect(document.getElementById(browse.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      CORE['productBrowser.trigger.noPermission'],
    );

    const quick = screen.getByRole('combobox', { name: CORE['rfqCreate.items.quickSearch']! });
    expect(quick).toBeDisabled();
    expect(document.getElementById(quick.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      CORE['productBrowser.trigger.noPermission'],
    );
    expect(getSpy.mock.calls.some(([p]) => String(p).startsWith('/api/v1/admin/catalog/products'))).toBe(false);
  });

  it('enables both with catalog:read', async () => {
    renderPage(['quote_requests:write', 'customers:read', 'catalog:read']);
    expect(await screen.findByRole('button', { name: CORE['productBrowser.trigger']! })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: CORE['rfqCreate.items.quickSearch']! })).toBeEnabled();
  });
});
