import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CreditLimitView } from '@endora-commerce/contracts';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { ApiError, INERT_SAVE_SESSION, formatMoney } from '@endora-commerce/admin-kit/lib';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { shippedModuleBundle } from '../../helpers/core-bundle';

/**
 * Issue #1544 (UX audit SALES-19) — credit limits were not reachable from the
 * Organization screen at all. `credit_limits` contributes a read-only summary
 * to `organization.detail.after` (the Commerce tab): the granted, reserved and
 * available amounts and the active reservations, or "no limit granted", with
 * one link that opens the credit-limit dialog for this organization on the
 * Credit limits screen. `organizations` names no contributor; the zone
 * renderer applies both presence axes and the contribution's permission, so
 * with the module off, or for somebody without `credit_limits:manage`, the
 * screen shows nothing of it and asks nothing.
 */

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OWN_URL = `/api/v1/admin/organizations/${ORG}/credit-limit`;
const DEEP_LINK = `/credit-limits?organizationId=${ORG}`;

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: (...a: unknown[]) => api.get(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const creditLimits = await import('../../../../packages/modules/credit_limits/src/admin/index');
const REGISTRY = [{ moduleId: 'credit_limits', contributions: creditLimits.contributions }];

const BUNDLE = { ...shippedModuleBundle('credit_limits', 'en') };
const cl = BUNDLE.credit_limits!;
const fill = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

/** As the DOM matcher reads it: Testing Library collapses the no-break spaces `Intl` writes. */
const money = (amount: number, currency: string): string => formatMoney(amount, currency).replace(/\s+/g, ' ');

const view = (overrides: Partial<CreditLimitView> = {}): CreditLimitView => ({
  organizationId: ORG,
  organizationName: 'Acme',
  grantedAmount: 10000,
  availableAmount: 7500,
  currency: 'PLN',
  activeReservationCount: 2,
  activeReservations: [],
  grantedAt: '2026-08-17T10:00:00.000Z',
  ...overrides,
});

const notGranted = (): ApiError =>
  new ApiError(404, { error: { code: 'CREDIT_LIMIT_NOT_GRANTED', message: 'Not granted.' } } as never);

function renderZone(
  options: { readonly permissions?: readonly string[]; readonly present?: readonly string[] } = {},
): HTMLElement {
  const { container } = renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[`/organizations/${ORG}`]}>
          <AdminZone name="organization.detail.after" props={{ organizationId: ORG, saveSession: INERT_SAVE_SESSION }} />
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      {
        session: adminSession({ permissions: [...(options.permissions ?? ['credit_limits:manage'])] }),
        presence: modulePresence({ present: [...(options.present ?? ['credit_limits', 'organizations'])] }),
        contributions: REGISTRY,
      },
    ),
    BUNDLE,
  );
  return container;
}

async function panel(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: cl['organizationPanel.title']! });
  return heading.closest('section') as HTMLElement;
}

beforeEach(() => {
  api.get.mockReset();
});
afterEach(() => cleanup());

describe('credit_limits contributes the organization detail zone (issue #1544)', () => {
  it('declares the contribution on credit_limits:manage, behind a dynamic import', () => {
    const zone = (creditLimits.contributions.zones ?? []).find((entry) => entry.zone === 'organization.detail.after');
    expect(zone).toBeDefined();
    expect(zone?.requiredPermission).toBe('credit_limits:manage');
    expect(zone?.weight).toBe(450);
    expect(typeof zone?.component).toBe('function');
  });

  it('summarises a granted limit and links to its dialog on the Credit limits screen', async () => {
    api.get.mockResolvedValue({ data: view() });
    renderZone();
    const section = await panel();
    await within(section).findByText(money(10000, 'PLN'));
    expect(within(section).getByText(cl['organizationPanel.granted']!)).toBeInTheDocument();
    expect(within(section).getByText(money(2500, 'PLN'))).toBeInTheDocument();
    expect(within(section).getByText(money(7500, 'PLN'))).toBeInTheDocument();
    expect(within(section).getByText('2')).toBeInTheDocument();
    const link = within(section).getByRole('link', { name: cl['list.adjust']! });
    expect(link).toHaveAttribute('href', DEEP_LINK);
    // Read-only: nothing in the panel edits, so nothing joins the page's Save.
    expect(within(section).queryByRole('textbox')).toBeNull();
    expect(within(section).queryByRole('spinbutton')).toBeNull();
    expect(api.get.mock.calls.map(([path]) => path)).toEqual([OWN_URL]);
  });

  it('says when the reservations exceed the limit, in words and not colour alone', async () => {
    api.get.mockResolvedValue({ data: view({ grantedAmount: 1000, availableAmount: -250 }) });
    renderZone();
    const section = await panel();
    expect(
      await within(section).findByText(fill(cl['organizationPanel.overdrawn']!, { amount: money(250, 'PLN') })),
    ).toBeInTheDocument();
  });

  it('says so when the organization has no limit, and offers to grant one', async () => {
    api.get.mockRejectedValue(notGranted());
    renderZone();
    const section = await panel();
    expect(await within(section).findByText(cl['organizationPanel.none']!)).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: cl['list.grant']! })).toHaveAttribute('href', DEEP_LINK);
  });

  it('says so when the limit cannot be read, and offers no link', async () => {
    api.get.mockRejectedValue(new Error('offline'));
    renderZone();
    const section = await panel();
    expect(await within(section).findByRole('alert')).toHaveTextContent(cl['organizationPanel.error']!);
    expect(within(section).queryByRole('link')).toBeNull();
  });

  it('announces loading through a status region mounted before the answer', async () => {
    let resolve: (value: unknown) => void = () => {};
    api.get.mockReturnValue(new Promise((r) => (resolve = r)));
    renderZone();
    const section = await panel();
    expect(within(section).getByRole('status')).toHaveTextContent(cl['organizationPanel.loading']!);
    resolve({ data: view() });
    await within(section).findByText(money(10000, 'PLN'));
    expect(within(section).getByRole('status')).toHaveTextContent('');
  });

  it('renders nothing and asks nothing without credit_limits:manage', async () => {
    const container = renderZone({ permissions: ['organizations:read'] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(container.querySelector('section')).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('renders nothing and asks nothing while credit_limits is not in the enabled set', async () => {
    const container = renderZone({ present: ['organizations'] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(container.querySelector('section')).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });
});
