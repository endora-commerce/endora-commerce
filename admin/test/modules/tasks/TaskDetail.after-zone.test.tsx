import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { setMobileViewport } from '../../setup';
import {
  TASK_ID,
  en,
  historyPage,
  renderTasks,
  taskDetail,
  workflow,
} from './tasks-fixtures';
import { markup } from '../../helpers/react-ids';

/**
 * `task.detail.after` — the panels other modules add about a Task
 * (`specs/163-projects-and-tasks/contracts/admin-surfaces.md` §3, task T067).
 *
 * The host mounts the zone once, as the last section of its sidebar card
 * (issue #1524), hands it the Task's id
 * and knows nothing of who fills it. **With nobody contributing — no module, a
 * module that is switched off, or a person without the contribution's
 * permission — the rendered screen is the one without the zone, byte for
 * byte.** The contributor here is a stand-in, so the host's test names no real
 * module (model: `orders/OrderDetail.after-zone.test.tsx`).
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { TaskDetail } = await import('../../../../packages/modules/tasks/src/admin/pages/TaskDetail');

function Probe({ taskId }: { taskId: string }): ReactNode {
  return <aside data-testid="after-probe">{`panel for ${taskId}`}</aside>;
}

/** A stand-in contributor: one panel, behind a permission of its own. */
const PROBE: AdminContributions = {
  zones: [
    zoneComponent('task.detail.after', () => Promise.resolve({ default: Probe }), {
      weight: 100,
      requiredPermission: 'probe:read',
    }),
  ],
};
const REGISTRY = [{ moduleId: 'blog', contributions: PROBE }];

async function renderDetail(options: {
  readonly registry: typeof REGISTRY | [];
  readonly permissions: readonly string[];
  readonly present: readonly string[];
}): Promise<HTMLElement> {
  cleanup();
  const { container } = renderTasks(<TaskDetail />, {
    path: `/tasks/${TASK_ID}`,
    pattern: '/tasks/:id',
    permissions: options.permissions,
    present: options.present,
    contributions: options.registry,
  });
  await screen.findByRole('heading', { name: /Order the racking/ });
  // The comments tab loads last; wait for it so two renders compare.
  await screen.findByText(en('comments.empty'));
  return container;
}

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/tasks/${TASK_ID}`) return Promise.resolve({ data: taskDetail() });
    if (path === '/api/v1/admin/tasks/workflow') return Promise.resolve({ data: workflow() });
    if (path.includes('/history')) return Promise.resolve(historyPage([]));
    if (path.endsWith('/comments')) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

describe('TaskDetail — the task.detail.after zone', () => {
  it('renders a contribution with the Task id, last in the sidebar card', async () => {
    const container = await renderDetail({
      registry: REGISTRY,
      permissions: ['tasks:read', 'probe:read'],
      present: ['tasks', 'blog'],
    });
    const probe = await screen.findByTestId('after-probe');
    expect(probe).toHaveTextContent(`panel for ${TASK_ID}`);
    const sidebar = screen.getByRole('complementary', { name: en('detail.sidebar') });
    expect(sidebar).toContainElement(probe);
    const related = within(sidebar).getByRole('region', { name: en('detail.related') });
    expect(related.compareDocumentPosition(probe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A section of that card: no card of its own around it.
    expect(probe.closest('[data-slot="card"]')).toBe(sidebar.querySelector('[data-slot="card"]'));
    expect(container.contains(probe)).toBe(true);
  });

  it('is identical to the screen with nobody contributing when the contributor is switched off', async () => {
    const baseline = markup(
      await renderDetail({ registry: [], permissions: ['tasks:read', 'probe:read'], present: ['tasks'] }),
    );
    const off = markup(
      await renderDetail({ registry: REGISTRY, permissions: ['tasks:read', 'probe:read'], present: ['tasks'] }),
    );
    expect(off).toBe(baseline);
    expect(off).not.toContain('after-probe');
  });

  it('is identical to it for somebody without the contribution’s permission', async () => {
    const baseline = markup(await renderDetail({ registry: [], permissions: ['tasks:read'], present: ['tasks', 'blog'] }));
    const refused = markup(
      await renderDetail({ registry: REGISTRY, permissions: ['tasks:read'], present: ['tasks', 'blog'] }),
    );
    expect(refused).toBe(baseline);
  });

  it('is the control: the two renders do differ once the contribution is shown', async () => {
    const baseline = markup(
      await renderDetail({ registry: [], permissions: ['tasks:read', 'probe:read'], present: ['tasks', 'blog'] }),
    );
    const shown = await renderDetail({
      registry: REGISTRY,
      permissions: ['tasks:read', 'probe:read'],
      present: ['tasks', 'blog'],
    });
    await screen.findByTestId('after-probe');
    expect(markup(shown)).not.toBe(baseline);
  });
});
