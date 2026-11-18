import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { expectNoAxeViolations } from '../../helpers/axe';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * Issue #1474 (SALES-09) — deleting an order status asks in the kit's
 * `ConfirmDialog`, not a hand-drawn overlay: named by its title, described by
 * the question, focus on *Cancel* (a destructive answer is chosen, not
 * defaulted into), Escape closing it and focus returning to the row's delete
 * button.
 */

installOffsetParentShim();

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

const BUNDLE = passthroughBundle('core', []);

function renderPage(): void {
  renderWithI18n(
    <MemoryRouter>
      <OrderStatusConfigPage />
    </MemoryRouter>,
    BUNDLE,
  );
}

/**
 * The delete button of the `pending` row — found by its row and its place
 * (last in the actions cell), not by its accessible name, which #1475 is
 * re-wording.
 */
async function pendingDeleteButton(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getAllByText('pending').length).toBeGreaterThan(0));
  const row = screen.getAllByRole('row').find((r) => within(r).queryAllByText('pending').length > 0 && within(r).queryAllByRole('button').length > 0);
  const buttons = within(row as HTMLElement).getAllByRole('button');
  return buttons[buttons.length - 1] as HTMLElement;
}

describe('OrderStatusConfigPage — the delete confirmation (#1474)', () => {
  it('asks in a modal dialog named by its title and described by the question, focused on Cancel', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await pendingDeleteButton());
    const dialog = screen.getByRole('dialog', { name: 'core.orderStatusConfig.deleteConfirm.title' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/core\.orderStatusConfig\.deleteConfirm\.body/);
    expect(within(dialog).getByRole('button', { name: /common\.action\.cancel/ })).toHaveFocus();
  });

  it('closes on Escape without deleting and returns focus to the delete button', async () => {
    const user = userEvent.setup();
    renderPage();
    const trigger = await pendingDeleteButton();
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it('deletes on the destructive answer', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await pendingDeleteButton());
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /common\.action\.delete/ }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('/api/v1/admin/orders/statuses/pending'));
  });

  it('has no axe violations while open', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await pendingDeleteButton());
    await expectNoAxeViolations(screen.getByRole('dialog').parentElement as HTMLElement);
  });
});
