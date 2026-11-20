import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `specs/182-related-payers/` RP-17 (e), FR-080 — the invoice list's organization filter: the
 * operator picks an Organization and the list asks for the invoices billing it
 * (`filter[organizationId]`), which lists a paid order's invoice under its payer.
 */
const getSpy = vi.fn();
const ORG_ID = '00000000-0000-4000-8000-0000000000b2';

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return {
    ...actual,
    OrganizationPicker: ({ onChange, ariaLabel }: { onChange: (id: string | null) => void; ariaLabel?: string }) => (
      <button type="button" aria-label={ariaLabel} onClick={() => onChange(ORG_ID)}>
        pick-organization
      </button>
    ),
  };
});

const { InvoicesList } = await import('../../../../packages/modules/invoices/src/admin/pages/InvoicesList');

beforeEach(() => {
  cleanup();
  getSpy.mockReset();
  getSpy.mockResolvedValue({ data: [], pagination: { cursor: null } });
});

describe('invoice list — organization filter (RP-17 e)', () => {
  it('asks for the invoices billing the picked Organization', async () => {
    renderWithI18n(
      withSession(
        <MemoryRouter>
          <InvoicesList />
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['invoices', 'organizations'] }) },
      ),
      { core: { 'common.listToolbar.moreFilters': 'More filters', 'invoices.filters.organization': 'Billed organization' } },
    );
    await userEvent.click(await screen.findByRole('button', { name: /^More filters/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Billed organization' }));
    await waitFor(() =>
      expect(
        getSpy.mock.calls.some(
          ([path]) =>
            typeof path === 'string' &&
            new URLSearchParams(path.split('?')[1] ?? '').get('filter[organizationId]') === ORG_ID,
        ),
      ).toBe(true),
    );
  });
});
