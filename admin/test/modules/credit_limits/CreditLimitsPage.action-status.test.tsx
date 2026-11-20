import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { CreditLimitView } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * Issue #1499 (UX audit SALES-17, owner decision DEC-12 a) — a granted or an
 * adjusted credit limit is said beside the list, in a polite region mounted
 * before it has text, not as a success banner at the top of the page. Since
 * issue #1664 the grant and adjust forms are a dialog that closes on success,
 * so the region is the list's notice, outside the dialog: a region inside it
 * would unmount with it before anything was read. Opening the dialog again,
 * for any organization, clears the previous result; a refused request is said
 * inside the dialog and leaves the region empty.
 */
installOffsetParentShim();

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';

const VIEW: CreditLimitView = {
  organizationId: ORG,
  organizationName: 'Acme',
  grantedAmount: 1000,
  availableAmount: 1000,
  currency: 'PLN',
  activeReservationCount: 0,
  activeReservations: [],
  grantedAt: '2026-08-17T10:00:00.000Z',
};

const state = { granted: false };
const post = vi.fn();
const patch = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: async (url: string) => {
        if (url.startsWith('/api/v1/admin/credit-limits')) {
          const data = state.granted ? [VIEW] : [];
          return { data, meta: { page: 1, pageSize: 20, total: data.length } };
        }
        if (url.endsWith('/credit-limit')) {
          if (state.granted && url.includes(ORG)) return { data: VIEW };
          throw new actual.ApiError(404, { error: { code: 'CREDIT_LIMIT_NOT_GRANTED', message: 'none' } } as never);
        }
        if (url === `/api/v1/admin/organizations/${ORG}`) return { data: { name: 'Acme' } };
        if (url === `/api/v1/admin/organizations/${OTHER}`) return { data: { name: 'Other' } };
        return { data: [] };
      },
      post: (...args: unknown[]) => post(...args),
      patch: (...args: unknown[]) => patch(...args),
    },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return {
    ...actual,
    OrganizationPicker: ({ onChange }: { onChange: (id: string | null) => void }) => (
      <>
        <button type="button" onClick={(): void => onChange(ORG)}>
          pick-acme
        </button>
        <button type="button" onClick={(): void => onChange(OTHER)}>
          pick-other
        </button>
      </>
    ),
    CurrencyPicker: () => <span />,
  };
});

const { CreditLimitsPage } = await import(
  '../../../../packages/modules/credit_limits/src/admin/pages/CreditLimitsPage'
);

function mount(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <CreditLimitsPage />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }) },
    ),
  );
}

/** The result region: the polite status that is not the list's count. */
function resultRegion(): HTMLElement {
  const regions = screen.getAllByRole('status').filter((r) => r.getAttribute('aria-atomic') === 'true');
  expect(regions).toHaveLength(1);
  return regions[0]!;
}

async function grantFor(pick: string): Promise<HTMLElement> {
  // Header while the list holds rows, the empty state's button otherwise — one of them at a time.
  await userEvent.click(await screen.findByRole('button', { name: 'credit_limits.list.grant' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: pick }));
  return dialog;
}

async function adjustFromRow(): Promise<HTMLElement> {
  fireEvent.pointerDown(await screen.findByRole('button', { name: 'credit_limits.list.rowMenu.label' }), {
    button: 0,
    ctrlKey: false,
  });
  await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'credit_limits.list.adjust' }));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  state.granted = false;
  post.mockReset();
  patch.mockReset();
});

describe('CreditLimitsPage — the result beside the list, not a banner (#1499)', () => {
  it('says the grant in a region mounted before it, which outlives the dialog', async () => {
    mount();
    const region = resultRegion();
    expect(region.textContent).toBe('');
    const dialog = await grantFor('pick-acme');
    const grant = await within(dialog).findByRole('button', { name: 'core.creditLimits.action.grant' });

    post.mockImplementation(async () => {
      state.granted = true;
      return { data: VIEW };
    });
    fireEvent.click(grant);

    await waitFor(() => expect(region).toHaveTextContent('core.creditLimits.success.grant'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(region.isConnected).toBe(true);
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();
  });

  it('says the adjustment beside the list and clears it when another organization is opened', async () => {
    state.granted = true;
    mount();
    const region = resultRegion();
    const dialog = await adjustFromRow();
    patch.mockResolvedValue({ data: VIEW });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'core.creditLimits.action.saveAdjust' }));

    await waitFor(() => expect(region).toHaveTextContent('core.creditLimits.success.adjust'));
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();

    const next = await grantFor('pick-other');
    await within(next).findByRole('button', { name: 'core.creditLimits.action.grant' });
    expect(region.textContent).toBe('');
  });

  it('a refused request is said in the dialog and leaves the region empty', async () => {
    state.granted = true;
    mount();
    const region = resultRegion();
    let dialog = await adjustFromRow();
    patch.mockResolvedValueOnce({ data: VIEW });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'core.creditLimits.action.saveAdjust' }));
    await waitFor(() => expect(region).toHaveTextContent('core.creditLimits.success.adjust'));

    dialog = await adjustFromRow();
    patch.mockRejectedValueOnce(new ApiError(422, { error: { code: 'OVER', message: 'Over allocation' } } as never));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'core.creditLimits.action.saveAdjust' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Over allocation');
    expect(region.textContent).toBe('');
  });
});
