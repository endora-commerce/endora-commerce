import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1040 (Principle XVI) — *Change tax ID*, the ⌘K action's screen: pick a
 * company organization, then correct its tax ID in the same form the page's
 * dialog uses.
 */
const getSpy = vi.fn();
const postSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (...a: unknown[]) => getSpy(...a), post: (...a: unknown[]) => postSpy(...a), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
const { ChangeTaxIdPage } = await import('../../../../packages/modules/organizations/src/admin/pages/ChangeTaxIdPage');
const { contributions } = await import('../../../../packages/modules/organizations/src/admin/index');
const { manifest } = await import('../../../../packages/modules/organizations/src/manifest');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const EN = read('../packages/modules/organizations/i18n/en.json');
const PL = read('../packages/modules/organizations/i18n/pl.json');
const CORE = read('../packages/modules/_i18n/i18n/en.json');

const COMPANY_ID = '00000000-0000-4000-8000-0000000010b1';
let companies: Array<{ id: string; name: string; legalName: null; status: string }> = [];

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  companies = [{ id: COMPANY_ID, name: 'Nowak Handel', legalName: null, status: 'active' }];
  getSpy.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/admin/organizations?')) {
      return { data: url.includes('includePersonal') ? [] : companies, pagination: { cursor: null, hasMore: false, limit: 25 } };
    }
    if (url === `/api/v1/admin/organizations/${COMPANY_ID}`) {
      return { data: { id: COMPANY_ID, name: 'Nowak Handel', taxId: 'PL5260250995', isPersonal: false } };
    }
    return { data: [] };
  });
});

function render(): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={['/organizations/change-tax-id']}>
          <Routes>
            <Route path="/organizations/change-tax-id" element={<ChangeTaxIdPage />} />
            <Route path="/organizations/:id" element={<p>detail page</p>} />
          </Routes>
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['organizations'] }), contributions: [] },
    ),
    { core: CORE, organizations: EN },
  );
}

describe('Change tax ID — screen', () => {
  it('is a route ahead of /:id under its permission, and a palette action with keywords in both languages', () => {
    const routes = contributions.routes ?? [];
    const route = routes.find((r) => r.path === '/organizations/change-tax-id');
    expect(route?.requiredPermission).toBe('organizations:change-tax-id');
    expect(routes.indexOf(route!)).toBeLessThan(routes.findIndex((r) => r.path === '/organizations/:id'));
    expect(manifest.actions?.find((a) => a.id === 'change-organization-tax-id')).toMatchObject({
      targetRoute: '/organizations/change-tax-id',
      requiredPermission: 'organizations:change-tax-id',
    });
    expect(manifest.permissions?.find((p) => p.code === 'organizations:change-tax-id')).toBeDefined();
    for (const bundle of [EN, PL]) {
      for (const key of ['label', 'description', 'keywords']) {
        expect(bundle[`actions.changeOrganizationTaxId.${key}`]).toEqual(expect.any(String));
      }
      expect(bundle['adminRoles.permission.organizations:change-tax-id']).toEqual(expect.any(String));
    }
  });

  it('picks a company organization, starts on its tax ID, changes it and opens it', async () => {
    postSpy.mockResolvedValue({ data: { id: COMPANY_ID, taxId: 'PL5260251177' }, changed: true, vatValidation: null });
    const user = userEvent.setup();
    render();
    expect(screen.getByText(EN['changeTaxId.page.step.choose']!)).toBeInTheDocument();
    expect(screen.getByText(EN['changeTaxId.page.step.details']!)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN['changeTaxId.page.next']! })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: EN['changeTaxId.page.picker']! }));
    await user.click(await screen.findByRole('option', { name: /Nowak Handel/ }));
    // The picker lists companies only: no personal organizations asked for.
    expect(getSpy.mock.calls.some(([url]) => String(url).startsWith('/api/v1/admin/organizations?') && !String(url).includes('includePersonal'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: EN['changeTaxId.page.next']! }));
    const field = (await screen.findByLabelText(new RegExp(`^${EN['changeTaxId.field.taxId']!}`))) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('PL5260250995'));
    fireEvent.change(field, { target: { value: 'PL5260251177' } });
    fireEvent.click(screen.getByRole('button', { name: EN['changeTaxId.submit']! }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/organizations/${COMPANY_ID}/change-tax-id`, expect.objectContaining({ taxId: 'PL5260251177' })),
    );
    expect(await screen.findByText('detail page')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render();
    await expectNoAxeViolations(container);
  });
});
