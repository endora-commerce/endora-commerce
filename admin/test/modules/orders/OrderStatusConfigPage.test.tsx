import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

const getSpy = vi.fn();
const deleteSpy = vi.fn();
const postSpy = vi.fn();
const putSpy = vi.fn();

// ECharts needs a real canvas; stub the wrapper so the page logic can be
// tested in jsdom. Edge-click selection is exercised via the kept From/To form.
vi.mock('@/components/charts/echart', () => ({
  EChart: (): null => null,
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/api-client')>(
    '@/lib/api-client',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: (...args: unknown[]) => putSpy(...args),
      patch: vi.fn(),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { OrderStatusConfigPage } = await import('../../../src/modules/orders/OrderStatusConfigPage');

const GRAPH = {
  statuses: [
    { code: 'new', name: { en: 'New' }, isInitial: true, isTerminal: false, isSystem: true, weight: 10, inUseCount: 3 },
    { code: 'pending', name: { en: 'Pending' }, isInitial: false, isTerminal: false, isSystem: false, weight: 20, inUseCount: 0 },
    { code: 'cancelled', name: { en: 'Cancelled' }, isInitial: false, isTerminal: true, isSystem: true, weight: 90, inUseCount: 0 },
  ],
  transitions: [
    { fromStatusCode: 'new', toStatusCode: 'pending', isSystem: false },
    { fromStatusCode: 'new', toStatusCode: 'cancelled', isSystem: true },
  ],
};

beforeEach(() => {
  getSpy.mockReset();
  deleteSpy.mockReset();
  postSpy.mockReset();
  putSpy.mockReset();
  getSpy.mockResolvedValue({ data: GRAPH });
  deleteSpy.mockResolvedValue({ data: { deleted: 'pending' } });
  postSpy.mockResolvedValue({ data: { code: 'x' } });
  putSpy.mockResolvedValue({ data: { transitions: [] } });
});

const BUNDLE = passthroughBundle('core', []);

function renderPage(): void {
  renderWithI18n(
    <MemoryRouter>
      <OrderStatusConfigPage />
    </MemoryRouter>,
    BUNDLE,
  );
}

describe('OrderStatusConfigPage', () => {
  it('lists the configured statuses and transitions', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('delete-new')).toBeInTheDocument());
    expect(screen.getAllByText('new').length).toBeGreaterThan(0);
    expect(screen.getAllByText('pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('cancelled').length).toBeGreaterThan(0);
    expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/orders/statuses');
  });

  it('disables delete for the initial/system status but allows a deletable one', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('delete-new')).toBeInTheDocument());
    expect(screen.getByLabelText('delete-new')).toBeDisabled(); // initial + system
    expect(screen.getByLabelText('delete-cancelled')).toBeDisabled(); // system
    expect(screen.getByLabelText('delete-pending')).not.toBeDisabled();
  });

  it('calls DELETE when removing a deletable status', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('delete-pending')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('delete-pending'));
    expect(deleteSpy).toHaveBeenCalledWith('/api/v1/admin/orders/statuses/pending');
  });

  it('adds a new transition via the From/To form', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('delete-new')).toBeInTheDocument());
    await userEvent.selectOptions(
      screen.getByLabelText('core.orderStatusConfig.col.from'),
      'pending',
    );
    await userEvent.selectOptions(screen.getByLabelText('core.orderStatusConfig.col.to'), 'cancelled');
    await userEvent.click(
      screen.getByRole('button', { name: 'core.orderStatusConfig.addTransition' }),
    );
    expect(putSpy).toHaveBeenCalledWith('/api/v1/admin/orders/transitions', {
      add: [{ fromStatusCode: 'pending', toStatusCode: 'cancelled' }],
    });
  });

  it('does not re-add an already-existing transition', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('delete-new')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('core.orderStatusConfig.col.from'), 'new');
    await userEvent.selectOptions(screen.getByLabelText('core.orderStatusConfig.col.to'), 'pending');
    await userEvent.click(
      screen.getByRole('button', { name: 'core.orderStatusConfig.addTransition' }),
    );
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('exposes the graph connect-mode toggle', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('delete-new')).toBeInTheDocument());
    expect(
      screen.getByRole('button', { name: 'core.orderStatusConfig.graph.connectMode' }),
    ).toBeInTheDocument();
  });
});
