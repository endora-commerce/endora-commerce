import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `specs/177-tax-id-scope/` T043 (`contracts/admin-surfaces.md` §4.5) — the
 * Organizations list header's menu reaches the installation-wide screens, each
 * entry shown only under its own permission, and the menu absent when none is.
 */
const getSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
const { OrganizationsList } = await import('../../../../packages/modules/organizations/src/admin/pages/OrganizationsList');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const EN = read('../packages/modules/organizations/i18n/en.json');
const CORE = read('../packages/modules/_i18n/i18n/en.json');

function render(permissions: string[]): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/organizations']}>
        <Routes>
          <Route path="/organizations" element={<OrganizationsList />} />
          <Route path="/organizations/tax-id-scope" element={<p>scope screen</p>} />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions }), presence: modulePresence({ present: ['organizations'] }), contributions: [] },
    ),
    { core: CORE, organizations: EN },
  );
}

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockResolvedValue({ data: [] });
});

describe('Organizations list — header menu', () => {
  it('offers the Tax-ID scope screen to a holder of organizations:manage-tax-id-scope', async () => {
    render(['customers:read', 'organizations:manage-tax-id-scope']);
    fireEvent.pointerDown(await screen.findByRole('button', { name: EN['list.menu.label'] }), { button: 0, ctrlKey: false });
    const item = await screen.findByRole('menuitem', { name: EN['list.menu.taxIdScope'] });
    expect(item.getAttribute('href')).toBe('/organizations/tax-id-scope');
  });

  it('shows no menu without any of its permissions', async () => {
    render(['customers:read']);
    await screen.findByText(CORE['organizations.page.title']!);
    expect(screen.queryByRole('button', { name: EN['list.menu.label'] })).not.toBeInTheDocument();
  });
});
