import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CreditLimitView } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Issue #1499 (UX audit SALES-17, owner decision DEC-12 a) — a granted or an
 * adjusted credit limit is said beside the organization's panel, in a polite
 * region mounted before it has text, not as a success banner at the top of the
 * page. The region sits outside the panel, because granting swaps the grant
 * form for the adjust form: a region inside it would be created already
 * carrying its message, which screen readers do not reliably announce.
 */

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
        if (url === '/api/v1/admin/credit-limits') return { data: state.granted ? [VIEW] : [] };
        if (url.endsWith('/credit-limit')) {
          if (state.granted && url.includes(ORG)) return { data: VIEW };
          throw new actual.ApiError(404, { error: { code: 'CREDIT_LIMIT_NOT_GRANTED', message: 'none' } });
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
    <MemoryRouter>
      <CreditLimitsPage />
    </MemoryRouter>,
  );
}

async function lookUp(pick: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: pick }));
  fireEvent.click(screen.getByRole('button', { name: 'core.creditLimits.action.lookup' }));
}

beforeEach(() => {
  state.granted = false;
  post.mockReset();
  patch.mockReset();
});

describe('CreditLimitsPage — the result beside the panel, not a banner (#1499)', () => {
  it('says the grant in a region that outlives the switch to the adjust form', async () => {
    mount();
    await lookUp('pick-acme');
    const grant = await screen.findByRole('button', { name: 'core.creditLimits.action.grant' });
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');

    post.mockImplementation(async () => {
      state.granted = true;
      return { data: VIEW };
    });
    fireEvent.click(grant);

    await screen.findByRole('button', { name: 'core.creditLimits.action.saveAdjust' });
    await waitFor(() => expect(region).toHaveTextContent('core.creditLimits.success.grant'));
    expect(region.isConnected).toBe(true);
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();
  });

  it('says the adjustment beside the panel and clears it when another organization is looked up', async () => {
    state.granted = true;
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'core.creditLimits.action.open' }));
    const save = await screen.findByRole('button', { name: 'core.creditLimits.action.saveAdjust' });
    const region = screen.getByRole('status');
    patch.mockResolvedValue({ data: VIEW });

    fireEvent.click(save);

    await waitFor(() => expect(region).toHaveTextContent('core.creditLimits.success.adjust'));
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();

    await lookUp('pick-other');
    await screen.findByRole('button', { name: 'core.creditLimits.action.grant' });
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('an error is the page banner and clears the previous result', async () => {
    state.granted = true;
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'core.creditLimits.action.open' }));
    const save = await screen.findByRole('button', { name: 'core.creditLimits.action.saveAdjust' });
    const region = screen.getByRole('status');
    patch.mockResolvedValueOnce({ data: VIEW });
    fireEvent.click(save);
    await waitFor(() => expect(region).toHaveTextContent('core.creditLimits.success.adjust'));

    patch.mockRejectedValueOnce(new ApiError(422, { error: { code: 'OVER', message: 'Over allocation' } }));
    fireEvent.click(screen.getByRole('button', { name: 'core.creditLimits.action.saveAdjust' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Over allocation');
    expect(region.textContent).toBe('');
  });
});
