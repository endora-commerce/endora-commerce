import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { shippedModuleBundle } from '../../helpers/core-bundle';
import { developerIdLabels } from '../../helpers/developer-ids';

const getSpy = vi.fn();
const deleteSpy = vi.fn();
const postSpy = vi.fn();
const putSpy = vi.fn();

/**
 * ECharts needs a real canvas, and jsdom has none: `echarts.init` reaches into
 * a 2D context that is `null` there and dies with
 * `Cannot read properties of null`. Edge-click selection is exercised via the
 * kept From/To form.
 *
 * **The library, not the wrapper.** This was `vi.mock('../../../../packages/admin-shell/src/components/charts/echart')`
 * until feature 091's batch 8 published `StatusTransitionGraph` into
 * `@endora-commerce/admin-kit`. The graph reaches its chart through the kit's
 * own internals now, so a mock of the admin's re-export shim intercepts nothing
 * — and the kit publishes no subpath for that internal module, which is right:
 * mocking a path inside another package's `dist` is not a seam anybody should
 * be asked to name. `echarts` is a bare specifier both sides resolve to one
 * file, so mocking it covers the kit's chart and the admin's alike. The graph's
 * own chrome — the connect-mode toggle, the From/To form — is the subject here
 * and still renders for real.
 */
vi.mock('echarts', () => {
  const chart = {
    setOption: (): void => {},
    resize: (): void => {},
    dispose: (): void => {},
    on: (): void => {},
    off: (): void => {},
    dispatchAction: (): void => {},
  };
  return { init: () => chart, default: { init: () => chart } };
});

// **Re-keyed by feature 091's Phase 4 batch 15, and this is the trap batch 14
// found by sweeping rather than by running.** The mock named `@/lib/api-client`
// while the subject was under `admin/src`; the subject is inside a module
// package now and resolves `@endora-commerce/admin-kit/lib`, of which
// `@/lib/api-client` is only a re-export shim — so the old spelling intercepts
// nothing and vitest reports that by making the mock **inert** rather than by
// failing. `tsc` cannot see it: both specifiers compile.
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
      patch: vi.fn(),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { OrderStatusConfigPage } = await import('../../../../packages/modules/orders/src/admin/pages/OrderStatusConfigPage');

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

const BUNDLE = {
  ...passthroughBundle('core', ['common.action.delete']),
  ...shippedModuleBundle('orders', 'en'),
};

function renderPage(): { container: HTMLElement } {
  return renderWithI18n(
    <MemoryRouter>
      <OrderStatusConfigPage />
    </MemoryRouter>,
    BUNDLE,
  );
}

describe('OrderStatusConfigPage', () => {
  it('names its icon buttons and the actions column in words, not developer ids (#1475)', async () => {
    const { container } = renderPage();
    expect(await screen.findByRole('button', { name: 'Edit status Pending' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    expect(developerIdLabels(container)).toEqual([]);
  });

  it('lists the configured statuses and transitions', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete status New' })).toBeInTheDocument());
    expect(screen.getAllByText('new').length).toBeGreaterThan(0);
    expect(screen.getAllByText('pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('cancelled').length).toBeGreaterThan(0);
    expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/orders/statuses');
  });

  it('disables delete for the initial/system status but allows a deletable one', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete status New' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Delete status New' })).toBeDisabled(); // initial + system
    expect(screen.getByRole('button', { name: 'Delete status Cancelled' })).toBeDisabled(); // system
    expect(screen.getByRole('button', { name: 'Delete status Pending' })).not.toBeDisabled();
  });

  it('calls DELETE when removing a deletable status', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete status Pending' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Delete status Pending' }));
    // Confirm in the deletion dialog.
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'core.orderStatusConfig.deleteConfirm.title' })).getByRole('button', {
        name: 'common.action.delete',
      }),
    );
    expect(deleteSpy).toHaveBeenCalledWith('/api/v1/admin/orders/statuses/pending');
  });

  it('adds a new transition via the From/To form', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete status New' })).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete status New' })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('core.orderStatusConfig.col.from'), 'new');
    await userEvent.selectOptions(screen.getByLabelText('core.orderStatusConfig.col.to'), 'pending');
    await userEvent.click(
      screen.getByRole('button', { name: 'core.orderStatusConfig.addTransition' }),
    );
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('exposes the graph connect-mode toggle', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete status New' })).toBeInTheDocument());
    expect(
      screen.getByRole('button', { name: 'core.orderStatusConfig.graph.connectMode' }),
    ).toBeInTheDocument();
  });

  it('says which graph toggles are on, not only by colour (aria-pressed, issue #1445)', async () => {
    renderPage();
    const connect = await screen.findByRole('button', { name: 'core.orderStatusConfig.graph.connectMode' });
    expect(connect).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(connect);
    expect(connect).toHaveAttribute('aria-pressed', 'true');

    const layout = screen.getByRole('group', { name: 'core.orderStatusConfig.graph.layout' });
    const none = within(layout).getByRole('button', { name: 'core.orderStatusConfig.graph.layoutNone' });
    const force = within(layout).getByRole('button', { name: 'core.orderStatusConfig.graph.layoutForce' });
    const pressed = (): string[] =>
      within(layout).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent ?? '');
    expect(pressed()).toHaveLength(1);
    await userEvent.click(force);
    expect(force).toHaveAttribute('aria-pressed', 'true');
    expect(none).toHaveAttribute('aria-pressed', 'false');
    expect(pressed()).toEqual(['core.orderStatusConfig.graph.layoutForce']);
  });
});
