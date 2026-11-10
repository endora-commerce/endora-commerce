import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { adminSession, renderWithSession } from '../../helpers/render-with-session';

/**
 * `specs/177-tax-id-scope/` T044 (FR-018; `contracts/admin-surfaces.md` §4.4) —
 * *New organization* may create a branch under a parent. Naming a parent is
 * parentage, the tenancy graph, so only an unscoped administrator is offered it
 * (D-260; the backend refuses the others with 403). With a parent chosen, the
 * form says a branch may use its head office's tax ID in the tree scope.
 */
const getSpy = vi.fn();
const postSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (...a: unknown[]) => getSpy(...a), post: (...a: unknown[]) => postSpy(...a), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
const { OrganizationCreate } = await import('../../../../packages/modules/organizations/src/admin/pages/OrganizationCreate');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/organizations/i18n/en.json');
const pl = read('../packages/modules/organizations/i18n/pl.json');
const bundle = { organizations: en, core: read('../packages/modules/_i18n/i18n/en.json') };

const RETAIL = '00000000-0000-4000-8000-00000000c001';
const HEAD = '00000000-0000-4000-8000-00000000e001';

function render(roleCode = 'test_role') {
  const session = adminSession({ permissions: ['customers:manage', 'customers:read'] });
  return renderWithSession(
    <MemoryRouter initialEntries={['/organizations/new']}>
      <Routes>
        <Route path="/organizations/new" element={<OrganizationCreate />} />
        <Route path="/organizations/:id" element={<p>detail page</p>} />
      </Routes>
    </MemoryRouter>,
    { session: { ...session, role: { ...session.role!, code: roleCode } }, bundle },
  );
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation(async (url: string) => {
    if (url === '/api/v1/admin/organizations/sales-channel-options') {
      return { data: [{ id: RETAIL, code: 'retail', name: { 'en-US': 'Retail' }, active: true, systemDefault: true }] };
    }
    if (url.startsWith('/api/v1/admin/organizations')) {
      return {
        data: [{ id: HEAD, name: 'Head Office', legalName: null, status: 'active' }],
        pagination: { cursor: null, hasMore: false, limit: 20 },
      };
    }
    throw new Error(`unexpected request: ${url}`);
  });
});

describe('New organization — parent', () => {
  it('lets an unscoped administrator create a branch under a parent, and hints at the shared tax ID', async () => {
    postSpy.mockResolvedValue({ data: { id: '00000000-0000-4000-8000-00000000d001' } });
    const user = userEvent.setup();
    render();
    await waitFor(() => screen.getByRole('checkbox', { name: /Retail/ }));
    expect(screen.queryByText(en['create.hint.sharedTaxId']!)).toBeNull();
    await user.click(screen.getByRole('combobox', { name: en['create.field.parent'] }));
    await user.click(await screen.findByRole('option', { name: /Head Office/ }));
    expect(await screen.findByText(en['create.hint.sharedTaxId']!)).toBeInTheDocument();

    const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fill(en['create.field.name']!, 'Branch Gdańsk');
    fill(en['create.field.taxId']!, 'PL5260001246');
    fill(en['create.field.street']!, 'ul. Długa 1');
    fill(en['create.field.postalCode']!, '80-001');
    fill(en['create.field.city']!, 'Gdańsk');
    fill(en['create.field.country']!, 'PL');
    fireEvent.click(screen.getByRole('button', { name: en['create.submit']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]![1]).toMatchObject({ parentId: HEAD });
  });

  it('sends no parentId when none is chosen', async () => {
    postSpy.mockResolvedValue({ data: { id: '00000000-0000-4000-8000-00000000d002' } });
    render();
    await waitFor(() => screen.getByRole('checkbox', { name: /Retail/ }));
    const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fill(en['create.field.name']!, 'Root Co');
    fill(en['create.field.taxId']!, 'PL5260001247');
    fill(en['create.field.street']!, 'ul. Krótka 2');
    fill(en['create.field.postalCode']!, '00-001');
    fill(en['create.field.city']!, 'Warszawa');
    fill(en['create.field.country']!, 'PL');
    fireEvent.click(screen.getByRole('button', { name: en['create.submit']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]![1]).not.toHaveProperty('parentId');
  });

  it('is not offered to a sales representative, whose reach is scoped', async () => {
    render('sales_representative');
    await waitFor(() => screen.getByRole('checkbox', { name: /Retail/ }));
    expect(screen.queryByRole('combobox', { name: en['create.field.parent'] })).toBeNull();
  });

  it('has its keys in both bundles', () => {
    for (const key of ['create.field.parent', 'create.field.parentHelp', 'create.hint.sharedTaxId']) {
      expect(en[key], key).toEqual(expect.any(String));
      expect(pl[key], key).toEqual(expect.any(String));
    }
  });
});
