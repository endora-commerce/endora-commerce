import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';
import { organizationSalesChannelsAnswer } from '../../helpers/organization-sales-channels';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1515 (UX audit 2026-11-17, SALES-02) — the organization detail stacked sixteen cards
 * of its own and five more from `organization.detail.after`, nine marked "applies immediately"
 * and the rest saved by the page Save. It is now one card of tabs — **Overview**, **Members &
 * roles**, **Commerce**, **Tax**, **Sales** — each a stack of sections (Hick, Miller/Chunking,
 * Common Region), with the page Save the one primary in the header (Von Restorff) and a tab
 * that holds unsaved work marked as such (Zeigarnik).
 *
 * `organization.detail.after` is one mount (Z13) in the Commerce tab, without `chrome="card"`:
 * every contribution renders as a section there. Since DS-20 (#1452, zone placement) the Sales
 * tab has a zone of its own, `organization.detail.sales`, where `crm` and `projects` contribute.
 */

installOffsetParentShim();

const getSpy = vi.fn();
const patchSpy = vi.fn();
const putSpy = vi.fn();
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
      put: (...args: unknown[]) => putSpy(...args),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const { OrganizationDetail } = await import(
  '../../../../packages/modules/organizations/src/admin/pages/OrganizationDetail'
);
const priceLists = await import('@endora-commerce/mod-price-lists/admin');
const crm = await import('@endora-commerce/mod-crm/admin');
const projects = await import('@endora-commerce/mod-projects/admin');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const coreEn = read('../packages/modules/_i18n/i18n/en.json');
const orgEn = read('../packages/modules/organizations/i18n/en.json');
const orgPl = read('../packages/modules/organizations/i18n/pl.json');
const corePl = read('../packages/modules/_i18n/i18n/pl.json');
const bundle = {
  core: coreEn,
  organizations: orgEn,
  price_lists: read('../packages/modules/price_lists/i18n/en.json'),
  crm: read('../packages/modules/crm/i18n/en.json'),
  projects: read('../packages/modules/projects/i18n/en.json'),
};
const crmEn = bundle.crm;
const projectsEn = bundle.projects;
const T = (key: string): string => {
  const value = orgEn[key];
  if (value === undefined) throw new Error(`missing organizations key ${key}`);
  return value;
};
const C = (key: string): string => {
  const value = coreEn[key];
  if (value === undefined) throw new Error(`missing core key ${key}`);
  return value;
};

const ORG_ID = '00000000-0000-4000-8000-000000001515';
const ORG_URL = `/api/v1/admin/organizations/${ORG_ID}`;

const DEFINITION = {
  id: '00000000-0000-4000-8000-00000000d015',
  entityType: 'organization',
  key: 'account_manager',
  label: { en: 'Account manager' },
  labelDefault: 'Account manager',
  valueType: 'text',
  required: false,
  sortOrder: 0,
  config: {},
  options: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let org: Record<string, unknown>;

function company(): Record<string, unknown> {
  return {
    id: ORG_ID,
    name: 'Acme',
    legalName: null,
    taxId: 'PL1234567890',
    status: 'active',
    vatStatus: 'vat_payer',
    isPersonal: false,
    registeredAddress: { street: 'ul. Długa 1', city: 'Gdańsk', postalCode: '80-001', country: 'PL' },
    orderConfirmationEmails: [],
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
    customFieldValues: { account_manager: 'Ada' },
    parentId: null,
    members: [],
    version: 1,
    updatedAt: '2026-05-01T09:00:00.000Z',
  };
}

type Registry = readonly { moduleId: string; contributions: typeof priceLists.contributions }[];
const PRICE_LISTS_ONLY: Registry = [{ moduleId: 'price_lists', contributions: priceLists.contributions }];
const WITH_SALES_CONTRIBUTORS: Registry = [
  ...PRICE_LISTS_ONLY,
  { moduleId: 'crm', contributions: crm.contributions },
  { moduleId: 'projects', contributions: projects.contributions },
];

function renderDetail(
  options: { entry?: string; permissions?: readonly string[]; registry?: Registry } = {},
): void {
  renderWithSession(
    <MemoryRouter initialEntries={[options.entry ?? `/organizations/${ORG_ID}`]}>
      <Routes>
        <Route path="/organizations/:id" element={<OrganizationDetail />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: [...(options.permissions ?? ['*'])] }),
      presence: modulePresence({ present: everyDeclaredModule() }),
      contributions: [...(options.registry ?? PRICE_LISTS_ONLY)],
      bundle,
    },
  );
}

async function tabs(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('tablist', { name: T('detail.tabs.label') });
  return within(list).getAllByRole('tab');
}

async function openTab(user: ReturnType<typeof userEvent.setup>, key: string): Promise<HTMLElement> {
  const strip = await tabs();
  const tab = strip.find((node) => node.textContent?.includes(T(key)));
  if (!tab) throw new Error(`no tab ${key}`);
  await user.click(tab);
  expect(tab).toHaveAttribute('aria-selected', 'true');
  return screen.getByRole('tabpanel');
}

const headingNames = (panel: HTMLElement): string[] =>
  within(panel)
    .getAllByRole('heading', { level: 2 })
    .map((node) => node.textContent?.trim() ?? '');

beforeEach(() => {
  org = company();
  getSpy.mockReset().mockImplementation(async (url: string) => {
    if (url === ORG_URL) return { data: { ...org } };
    if (url === `${ORG_URL}/restrictions`) {
      return { data: { organizationId: ORG_ID, paymentMethodIds: [], deliveryMethodIds: [], warehouseIds: [], version: 1 } };
    }
    if (url === '/api/v1/admin/custom-fields/definitions?entityType=organization') return { data: [DEFINITION] };
    if (url.startsWith('/api/v1/admin/warehouses')) return { items: [] };
    if (url.startsWith('/api/v1/admin/pricing/display-mode-overrides/organization/')) return { data: { mode: null } };
    const channels = organizationSalesChannelsAnswer(url);
    if (channels) return channels;
    return { data: [], items: [], meta: { total: 0, page: 1, pageSize: 20 } };
  });
  patchSpy.mockReset();
  putSpy.mockReset();
  postSpy.mockReset().mockResolvedValue({ data: {} });
});
afterEach(() => cleanup());

describe('organization detail — one card of tabs (#1515)', () => {
  it('offers five tabs and opens on Overview', async () => {
    renderDetail();
    const strip = await tabs();
    expect(strip.map((tab) => tab.textContent?.trim())).toEqual([
      T('detail.tabs.overview'),
      T('detail.tabs.members'),
      T('detail.tabs.commerce'),
      T('detail.tabs.tax'),
      T('detail.tabs.sales'),
    ]);
    expect(strip[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('Overview holds status, address, hierarchy and custom fields as sections, not cards', async () => {
    renderDetail();
    await tabs();
    const panel = screen.getByRole('tabpanel');
    await within(panel).findByLabelText('Account manager');
    const names = headingNames(panel);
    expect(names.some((name) => name.startsWith(C('organizations.moderation.title')))).toBe(true);
    expect(names).toContain(C('organizations.detail.registeredAddress'));
    expect(names.some((name) => name.startsWith(C('organizations.detail.hierarchyCard')))).toBe(true);
    // Common Region: one card, sections inside it — no card in the card.
    expect(panel.querySelector('[data-slot="card"]')).toBeNull();
    // Moderation says only what this status allows (#1541): an active organization can be blocked.
    expect(within(panel).getByRole('button', { name: C('organizations.moderation.action.block') })).toBeEnabled();
    expect(within(panel).queryByRole('button', { name: C('organizations.moderation.action.approve') })).toBeNull();
  });

  it('Commerce holds the channels, ordering rules, price lists and the zone panels as sections', async () => {
    const user = userEvent.setup();
    renderDetail();
    const panel = await openTab(user, 'detail.tabs.commerce');
    await within(panel).findByLabelText(C('priceLists.displayMode.rowLabel'));
    const names = headingNames(panel);
    expect(names.some((name) => name.startsWith(orgEn['salesChannels.title']!))).toBe(true);
    expect(names).toContain(C('organizations.detail.notificationsCard'));
    expect(names).toContain(C('organizations.restrictions.title'));
    expect(names).toContain(C('fulfilment.orgTitle'));
    expect(names).toContain(C('organizations.applicablePriceLists.title'));
    expect(panel.querySelector('[data-slot="card"]')).toBeNull();
  });

  it('opens a tab from ?tab=', async () => {
    renderDetail({ entry: `/organizations/${ORG_ID}?tab=tax` });
    const strip = await tabs();
    expect(strip[3]).toHaveAttribute('aria-selected', 'true');
  });

  it('Tax holds the tax identity with its corrections, and the VAT validation', async () => {
    const user = userEvent.setup();
    renderDetail();
    const panel = await openTab(user, 'detail.tabs.tax');
    const names = headingNames(panel);
    expect(names).toContain(T('detail.tax.title'));
    expect(names.some((name) => name.startsWith(C('organizations.vatValidation.title')))).toBe(true);
    expect(within(panel).getByRole('button', { name: T('changeTaxId.button') })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: T('changeVatStatus.button') })).toBeInTheDocument();
    expect(panel.querySelector('[data-slot="card"]')).toBeNull();
  });

  it('a personal organization offers the conversion on Tax and has no VAT validation', async () => {
    org = { ...company(), isPersonal: true, taxId: null, vatStatus: 'vat_exempt' };
    const user = userEvent.setup();
    renderDetail();
    const panel = await openTab(user, 'detail.tabs.tax');
    expect(within(panel).getByRole('button', { name: T('convertToCompany.button') })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: T('changeTaxId.button') })).toBeNull();
    expect(headingNames(panel).some((name) => name.startsWith(C('organizations.vatValidation.title')))).toBe(false);
  });

  it('Members & roles holds the members and the roles', async () => {
    const user = userEvent.setup();
    renderDetail();
    const panel = await openTab(user, 'detail.tabs.members');
    await waitFor(() => {
      const names = headingNames(panel);
      expect(names.some((name) => name.startsWith(C('organizations.detail.membersCard')))).toBe(true);
      expect(names).toContain(T('roles.tab.title'));
    });
    expect(panel.querySelector('[data-slot="card"]')).toBeNull();
  });

  it('Sales holds the sales representatives, and is not offered without the code', async () => {
    const user = userEvent.setup();
    renderDetail();
    const panel = await openTab(user, 'detail.tabs.sales');
    expect(headingNames(panel).some((name) => name.startsWith(C('organizations.salesReps.title')))).toBe(true);
    cleanup();
    renderDetail({ permissions: ['customers:read', 'customers:manage'] });
    const strip = await tabs();
    expect(strip.map((tab) => tab.textContent?.trim())).not.toContain(T('detail.tabs.sales'));
  });

  it('the header has the page Save as its one primary and no tax buttons', async () => {
    renderDetail();
    await tabs();
    const group = document.querySelector<HTMLElement>('[data-slot="detail-header-actions"]')!;
    expect(within(group).queryByRole('button', { name: T('changeTaxId.button') })).toBeNull();
    expect(within(group).queryByRole('button', { name: T('changeVatStatus.button') })).toBeNull();
    expect(within(group).getByRole('button', { name: /^Save/ })).toBeInTheDocument();
  });

  // #1549 (SALES-27): the way back is the header's back link, not an outline button beside Save.
  it('goes back through the header back link, not a button among the actions', async () => {
    renderDetail();
    await tabs();
    const heading = screen.getByRole('heading', { level: 1 });
    const back = within(heading.closest('header')!).getByRole('link', { name: C('organizations.page.title') });
    expect(back).toHaveAttribute('href', '/organizations');
    const group = document.querySelector<HTMLElement>('[data-slot="detail-header-actions"]')!;
    expect(within(group).queryByRole('link', { name: C('organizations.page.title') })).toBeNull();
  });

  it('marks the tab that holds unsaved work, and keeps the draft across tabs', async () => {
    const user = userEvent.setup();
    renderDetail();
    const field = await screen.findByLabelText(orgEn['detail.orderConfirmationEmails']!);
    fireEvent.change(field, { target: { value: 'ops@example.com' } });
    const [overview, , commerce] = await tabs();
    await waitFor(() => expect(commerce).toHaveAccessibleName(new RegExp(T('detail.tabs.unsaved'))));
    expect(overview).not.toHaveAccessibleName(new RegExp(T('detail.tabs.unsaved')));
    await user.click(commerce!);
    await user.click(overview!);
    expect((screen.getByLabelText(orgEn['detail.orderConfirmationEmails']!) as HTMLTextAreaElement).value).toBe('ops@example.com');
    fireEvent.change(screen.getByLabelText('Account manager'), { target: { value: 'Bea' } });
    await waitFor(() => expect(overview).toHaveAccessibleName(new RegExp(T('detail.tabs.unsaved'))));
  });

  it('passes axe on every tab', async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByLabelText('Account manager');
    await expectNoAxeViolations(document.body);
    for (const key of ['detail.tabs.members', 'detail.tabs.commerce', 'detail.tabs.tax', 'detail.tabs.sales']) {
      await openTab(user, key);
      await expectNoAxeViolations(document.body);
    }
  });
});

describe('organization detail — the Sales tab zone (#1452, DS-20)', () => {
  const crmTitle = (): string => crmEn['organizationPanel.title']!;
  const projectsTitle = (): string => projectsEn['organizationPanel.title']!;
  const salesOnlyContributors = ['customers:read', 'customers:manage', 'crm:read', 'projects:read'];

  it('holds crm’s opportunities and projects’ projects after the sales representatives, not in Commerce', async () => {
    const user = userEvent.setup();
    renderDetail({ registry: WITH_SALES_CONTRIBUTORS });
    const sales = await openTab(user, 'detail.tabs.sales');
    await within(sales).findByRole('heading', { level: 2, name: crmTitle() });
    await within(sales).findByRole('heading', { level: 2, name: projectsTitle() });
    const names = headingNames(sales);
    const reps = names.findIndex((name) => name.startsWith(C('organizations.salesReps.title')));
    expect(reps).toBeGreaterThanOrEqual(0);
    // Weight order after the host's own section: crm 600, projects 650.
    expect(names.indexOf(crmTitle())).toBeGreaterThan(reps);
    expect(names.indexOf(projectsTitle())).toBeGreaterThan(names.indexOf(crmTitle()));
    // Sections of the tab's card, never a card in a card.
    expect(sales.querySelector('[data-slot="card"]')).toBeNull();

    const commerce = await openTab(user, 'detail.tabs.commerce');
    await within(commerce).findByLabelText(C('priceLists.displayMode.rowLabel'));
    expect(headingNames(commerce)).not.toContain(crmTitle());
    expect(headingNames(commerce)).not.toContain(projectsTitle());
  });

  it('is offered for the zone alone, without the sales-rep code', async () => {
    const user = userEvent.setup();
    renderDetail({ registry: WITH_SALES_CONTRIBUTORS, permissions: salesOnlyContributors });
    const sales = await openTab(user, 'detail.tabs.sales');
    await within(sales).findByRole('heading', { level: 2, name: crmTitle() });
    expect(headingNames(sales).some((name) => name.startsWith(C('organizations.salesReps.title')))).toBe(false);
  });

  it('is not offered when neither the sales-rep code nor a contribution fills it, and ?tab=sales falls back to Overview', async () => {
    renderDetail({
      entry: `/organizations/${ORG_ID}?tab=sales`,
      registry: WITH_SALES_CONTRIBUTORS,
      permissions: ['customers:read', 'customers:manage'],
    });
    const strip = await tabs();
    expect(strip.map((tab) => tab.textContent?.trim())).not.toContain(T('detail.tabs.sales'));
    expect(strip[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('passes axe on Sales with both contributions', async () => {
    const user = userEvent.setup();
    renderDetail({ registry: WITH_SALES_CONTRIBUTORS });
    const sales = await openTab(user, 'detail.tabs.sales');
    await within(sales).findByRole('heading', { level: 2, name: projectsTitle() });
    await expectNoAxeViolations(document.body);
  });
});

describe('organization detail — strings (#1515)', () => {
  it('ships the new strings in English and Polish', () => {
    for (const key of [
      'detail.tabs.label',
      'detail.tabs.overview',
      'detail.tabs.members',
      'detail.tabs.commerce',
      'detail.tabs.tax',
      'detail.tabs.sales',
      'detail.tabs.unsaved',
      'detail.tax.title',
      'detail.tax.noTaxId',
      'moderation.registryDivergence',
      'moderation.registryDivergenceLink',
    ]) {
      expect(orgEn[key], key).toBeTruthy();
      expect(orgPl[key], key).toBeTruthy();
    }
    expect(corePl['organizations.moderation.title']).toBeTruthy();
  });
});
