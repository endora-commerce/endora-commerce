import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { OrganizationSalesChannelOptionsResponse } from '@endora-commerce/contracts';
import { adminSession, renderWithSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * `specs/154-sales-channel-access/` T066 — *New organization*
 * (contracts/admin-api-and-ui.md §3, US5).
 *
 * An operator creates a customer Organization and chooses the stores its
 * members may use. The route and the roster's button need `customers:manage`;
 * the *Sales channels* field pre-selects the system default, which is what every
 * other creation path assigns; a successful create lands on the new
 * Organization's page. The palette reaches the same screen.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OrganizationCreate } = await import(
  '../../../../packages/modules/organizations/src/admin/pages/OrganizationCreate'
);
const { OrganizationsList } = await import(
  '../../../../packages/modules/organizations/src/admin/pages/OrganizationsList'
);
const { contributions } = await import(
  '../../../../packages/modules/organizations/src/admin/index'
);
const { manifest } = await import('../../../../packages/modules/organizations/src/manifest');

const enPath = resolve(process.cwd(), '../packages/modules/organizations/i18n/en.json');
const en = JSON.parse(readFileSync(enPath, 'utf8')) as Record<string, string>;
const pl = JSON.parse(readFileSync(enPath.replace('en.json', 'pl.json'), 'utf8')) as Record<
  string,
  string
>;
const coreEn = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { organizations: en, core: coreEn };

const RETAIL = '00000000-0000-4000-8000-00000000c001';
const TRADE = '00000000-0000-4000-8000-00000000c002';
const CREATED = '00000000-0000-4000-8000-00000000d001';

const OPTIONS: OrganizationSalesChannelOptionsResponse = {
  data: [
    { id: TRADE, code: 'trade', name: { 'en-US': 'Trade' }, active: true, systemDefault: false },
    { id: RETAIL, code: 'retail', name: { 'en-US': 'Retail' }, active: true, systemDefault: true },
  ],
};

function renderCreate() {
  return renderWithSession(
    <StrictMode>
      <MemoryRouter initialEntries={['/organizations/new']}>
        <Routes>
          <Route path="/organizations/new" element={<OrganizationCreate />} />
          <Route path="/organizations/:id" element={<p>detail page</p>} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
    { session: adminSession({ permissions: ['customers:manage'] }), bundle },
  );
}

function fill(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation(async (url: string) => {
    if (url === '/api/v1/admin/organizations/sales-channel-options') return OPTIONS;
    if (url.startsWith('/api/v1/admin/organizations')) return { data: [], meta: { page: 1, pageSize: 20, total: 0 } };
    throw new Error(`unexpected request: ${url}`);
  });
});

describe('registration', () => {
  it('declares /organizations/new behind customers:manage, ahead of the detail route', () => {
    const routes = contributions.routes ?? [];
    const create = routes.find((route) => route.path === '/organizations/new');
    expect(create?.requiredPermission).toBe('customers:manage');
    expect(routes.findIndex((r) => r.path === '/organizations/new')).toBeLessThan(
      routes.findIndex((r) => r.path === '/organizations/:id'),
    );
  });

  it('is reachable from the palette with the same permission', () => {
    const action = manifest.actions?.find((a) => a.id === 'new-organization');
    expect(action).toMatchObject({
      targetRoute: '/organizations/new',
      requiredPermission: 'customers:manage',
      icon: 'Building2',
      labelKey: 'actions.newOrganization.label',
      descriptionKey: 'actions.newOrganization.description',
    });
    for (const language of [en, pl]) {
      expect(language['actions.newOrganization.label']).toBeTruthy();
      expect(language['actions.newOrganization.description']).toBeTruthy();
    }
    expect(en['actions.newOrganization.label']).toBe('New organization');
    expect(pl['actions.newOrganization.label']).toBe('Nowa organizacja');
  });
});

describe('OrganizationCreate', () => {
  it('pre-selects the system-default channel', async () => {
    const { container } = renderCreate();
    await waitFor(() =>
      expect((screen.getByRole('checkbox', { name: /Retail/ }) as HTMLInputElement).checked).toBe(true),
    );
    expect((screen.getByRole('checkbox', { name: /Trade/ }) as HTMLInputElement).checked).toBe(false);
    await expectNoAxeViolations(container);
  });

  // #1436 (DS-02): no page description; what follows the create is said beside its Save.
  it('says beside Save that members are invited afterwards, with no page description', async () => {
    renderCreate();
    await waitFor(() => screen.getByRole('checkbox', { name: /Retail/ }));
    const header = screen.getByRole('heading', { level: 1, name: en['create.title']! }).closest('header')!;
    expect(header.querySelector('p')).toBeNull();
    const hint = screen.getByText(en['create.hint.inviteMembers']!);
    expect(hint.parentElement).toContainElement(screen.getByRole('button', { name: en['create.submit']! }));
  });

  // #1549 (SALES-27): the way back is the header's own back link, above the title.
  it('goes back through the header back link above the title', async () => {
    renderCreate();
    const heading = await screen.findByRole('heading', { level: 1, name: en['create.title']! });
    const back = screen.getByRole('link', { name: en['create.back']! });
    expect(heading.closest('header')).toContainElement(back);
    expect(back).toHaveAttribute('href', '/organizations');
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('creates the Organization with the chosen channels and opens it', async () => {
    postSpy.mockResolvedValue({ data: { id: CREATED } });
    renderCreate();
    await waitFor(() => screen.getByRole('checkbox', { name: /Retail/ }));
    fill(en['create.field.name']!, 'Acme Trade');
    fill(en['create.field.taxId']!, 'PL5260001246');
    fill(en['create.field.street']!, 'ul. Prosta 1');
    fill(en['create.field.postalCode']!, '00-001');
    fill(en['create.field.city']!, 'Warszawa');
    fill(en['create.field.country']!, 'pl');
    fireEvent.click(screen.getByRole('checkbox', { name: /Trade/ }));
    fireEvent.click(screen.getByRole('button', { name: en['create.submit']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/organizations', {
      name: 'Acme Trade',
      taxId: 'PL5260001246',
      registeredAddress: {
        street: 'ul. Prosta 1',
        postalCode: '00-001',
        city: 'Warszawa',
        country: 'PL',
      },
      status: 'active',
      // In the order the channels are listed, whatever order they were ticked in.
      salesChannelIds: [TRADE, RETAIL],
    });
    await waitFor(() => expect(screen.getByText('detail page')).toBeTruthy());
  });

  it('cannot be submitted with no sales channel, and says why', async () => {
    renderCreate();
    await waitFor(() => screen.getByRole('checkbox', { name: /Retail/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Retail/ }));
    expect(screen.getByRole('alert').textContent).toBe(en['salesChannels.atLeastOne']);
    expect(
      (screen.getByRole('button', { name: en['create.submit']! }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('OrganizationsList — New organization', () => {
  function renderList(permissions: readonly string[]) {
    return renderWithSession(
      <MemoryRouter>
        <OrganizationsList />
      </MemoryRouter>,
      { session: adminSession({ permissions }), bundle },
    );
  }

  it('is offered with customers:manage', async () => {
    renderList(['customers:manage']);
    const link = await screen.findByRole('link', { name: en['list.newOrganization']! });
    expect(link.getAttribute('href')).toBe('/organizations/new');
  });

  it('is not offered with customers:read alone', async () => {
    renderList(['customers:read']);
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: en['list.newOrganization']! })).toBeNull();
  });
});
