import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';

/**
 * Issue #1322 — the Organizations list chose and showed the same codes the
 * detail screen did: its status filter listed `pending_verification`, `active`,
 * … and its VAT column printed `vat_payer`. Both read the module's own labels,
 * in English and Polish.
 */
const getSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
const { OrganizationsList } = await import('../../../../packages/modules/organizations/src/admin/pages/OrganizationsList');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const CATALOGUES = {
  en: { core: read('../packages/modules/_i18n/i18n/en.json'), organizations: read('../packages/modules/organizations/i18n/en.json') },
  pl: { core: read('../packages/modules/_i18n/i18n/pl.json'), organizations: read('../packages/modules/organizations/i18n/pl.json') },
};

const ROW = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Acme',
  taxId: '1234567890',
  isPersonal: false,
  status: 'active',
  vatStatus: 'reverse_charge',
  createdAt: '2026-05-01T09:00:00.000Z',
};

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  getSpy.mockResolvedValue({ data: [ROW], meta: { page: 1, pageSize: 20, total: 1 } });
});
afterEach(() => cleanup());

describe.each(['en', 'pl'] as const)('Organizations list labels (%s) — issue #1322', (language) => {
  const { core, organizations: own } = CATALOGUES[language];

  it('labels the status filter options and the VAT column from the catalogue', async () => {
    renderWithI18n(
      withSession(
        <MemoryRouter initialEntries={['/organizations']}>
          <Routes>
            <Route path="/organizations" element={<OrganizationsList />} />
          </Routes>
        </MemoryRouter>,
        { session: adminSession({ permissions: ['customers:read'] }), presence: modulePresence({ present: ['organizations'] }), contributions: [] },
      ),
      CATALOGUES[language],
      { language },
    );
    expect(await screen.findByText(own['vatStatus.reverse_charge']!)).toBeInTheDocument();
    const filter = screen.getByLabelText(core['organizations.field.status']!);
    const options = within(filter).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([
      core['organizations.filter.all'],
      ...['pending_verification', 'active', 'blocked', 'rejected'].map((s) => own[`status.${s}`]),
    ]);
    expect(options.every(Boolean)).toBe(true);
  });
});
