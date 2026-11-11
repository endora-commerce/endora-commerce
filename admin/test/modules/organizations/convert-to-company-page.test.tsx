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
 * `specs/177-tax-id-scope/` T063 (FR-042; `contracts/admin-surfaces.md` §2, §3,
 * §4.3, §4.5) — *Convert personal organization*, the ⌘K action's screen: pick
 * a personal organization, then give its company details.
 */
const getSpy = vi.fn();
const postSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (...a: unknown[]) => getSpy(...a), post: (...a: unknown[]) => postSpy(...a), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
const { ConvertToCompanyPage } = await import('../../../../packages/modules/organizations/src/admin/pages/ConvertToCompanyPage');
const { OrganizationsList } = await import('../../../../packages/modules/organizations/src/admin/pages/OrganizationsList');
const { contributions } = await import('../../../../packages/modules/organizations/src/admin/index');
const { manifest } = await import('../../../../packages/modules/organizations/src/manifest');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const EN = read('../packages/modules/organizations/i18n/en.json');
const PL = read('../packages/modules/organizations/i18n/pl.json');
const CORE = read('../packages/modules/_i18n/i18n/en.json');

const PERSON = '00000000-0000-4000-8000-0000000000f1';
let personal: Array<{ id: string; name: string; legalName: null; status: string }> = [];

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  personal = [{ id: PERSON, name: 'Ewa Nowak', legalName: null, status: 'active' }];
  getSpy.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/dictionary')) {
      return { data: { countries: [{ code: 'PL', label: 'Poland', alpha3Code: 'POL', numericCode: '616', region: 'europe', subregion: null, dialCode: '+48', isEuMember: true, sortOrder: 1 }] } };
    }
    if (url.startsWith('/api/v1/admin/organizations?')) {
      return { data: url.includes('filter%5BisPersonal%5D=true') ? personal : [], pagination: { cursor: null, hasMore: false, limit: 25 } };
    }
    return { data: [] };
  });
});

function render(path = '/organizations/convert-to-company', permissions: string[] = ['*']): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/organizations" element={<OrganizationsList />} />
            <Route path="/organizations/convert-to-company" element={<ConvertToCompanyPage />} />
            <Route path="/organizations/:id" element={<p>detail page</p>} />
          </Routes>
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      { session: adminSession({ permissions }), presence: modulePresence({ present: ['organizations'] }), contributions: [] },
    ),
    { core: CORE, organizations: EN },
  );
}

describe('Convert personal organization — screen', () => {
  it('is a route ahead of /:id under its permission, and a palette action with keywords in both languages', () => {
    const routes = contributions.routes ?? [];
    const route = routes.find((r) => r.path === '/organizations/convert-to-company');
    expect(route?.requiredPermission).toBe('organizations:convert-to-company');
    expect(routes.indexOf(route!)).toBeLessThan(routes.findIndex((r) => r.path === '/organizations/:id'));
    expect(manifest.actions?.find((a) => a.id === 'convert-personal-organization')).toMatchObject({
      targetRoute: '/organizations/convert-to-company',
      requiredPermission: 'organizations:convert-to-company',
      icon: 'Building2',
    });
    for (const bundle of [EN, PL]) {
      for (const key of ['label', 'description', 'keywords']) {
        expect(bundle[`actions.convertPersonalOrganization.${key}`]).toEqual(expect.any(String));
      }
    }
  });

  it('shows its two steps, picks a personal organization, converts it and opens it', async () => {
    postSpy.mockResolvedValue({ data: { id: PERSON, name: 'Nowak Handel', isPersonal: false }, vatValidation: null });
    const user = userEvent.setup();
    render();
    expect(screen.getByText(EN['convertToCompany.page.step.choose']!)).toBeInTheDocument();
    expect(screen.getByText(EN['convertToCompany.page.step.details']!)).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: EN['convertToCompany.page.picker']! }));
    await user.click(await screen.findByRole('option', { name: /Ewa Nowak/ }));
    expect(getSpy.mock.calls.some(([url]) => String(url).includes('includePersonal=true&filter%5BisPersonal%5D=true'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: EN['convertToCompany.page.next']! }));
    fireEvent.change(screen.getByLabelText(new RegExp(`^${EN['convertToCompany.field.name']!}`)), { target: { value: 'Nowak Handel' } });
    fireEvent.change(screen.getByLabelText(new RegExp(`^${EN['convertToCompany.field.taxId']!}`)), { target: { value: '5260250995' } });
    fireEvent.change(screen.getByLabelText(new RegExp(`^${EN['convertToCompany.field.street']!}`)), { target: { value: 'ul. Handlowa 2' } });
    fireEvent.change(screen.getByLabelText(new RegExp(`^${EN['convertToCompany.field.postalCode']!}`)), { target: { value: '60-001' } });
    fireEvent.change(screen.getByLabelText(new RegExp(`^${EN['convertToCompany.field.city']!}`)), { target: { value: 'Poznań' } });
    // No organization to start from, so the country is picked.
    await user.click(screen.getByRole('combobox', { name: EN['convertToCompany.field.country']! }));
    await user.click(await screen.findByRole('option', { name: /Poland/ }));
    fireEvent.click(screen.getByRole('button', { name: EN['convertToCompany.submit']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/organizations/${PERSON}/convert-to-company`, expect.anything()));
    expect(await screen.findByText('detail page')).toBeInTheDocument();
  });

  it('keeps Next disabled until an organization is chosen, and says when none match', async () => {
    personal = [];
    const user = userEvent.setup();
    render();
    expect(screen.getByRole('button', { name: EN['convertToCompany.page.next']! })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: EN['convertToCompany.page.picker']! }));
    await user.type(screen.getByRole('combobox', { name: EN['convertToCompany.page.picker']! }), 'zz');
    expect((await screen.findAllByText(EN['convertToCompany.page.empty']!)).length).toBeGreaterThan(0);
  });

  it('has no axe violations', async () => {
    const { container } = render();
    await expectNoAxeViolations(container);
  });

  it('is offered in the Organizations list header menu under its permission', async () => {
    render('/organizations', ['customers:read', 'organizations:convert-to-company']);
    fireEvent.pointerDown(await screen.findByRole('button', { name: EN['list.menu.label']! }), { button: 0, ctrlKey: false });
    const item = await screen.findByRole('menuitem', { name: EN['list.menu.convertPersonal']! });
    expect(item.getAttribute('href')).toBe('/organizations/convert-to-company');
    expect(screen.queryByRole('menuitem', { name: EN['list.menu.taxIdScope']! })).toBeNull();
  });
});
