import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { AdminZoneName } from '@endora-commerce/contracts';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { PROJECT_ID, en, renderProjects, summary } from './projects-fixtures';

/**
 * The Project panel on the screens of the records a Project holds
 * (`specs/163-projects-and-tasks/`, User Story 6 — tasks T091 and T096;
 * `contracts/admin-surfaces.md` §3, spec FR-022, US5 sc.5).
 *
 * `projects` contributes one panel to four zones — an Order's, a Quote
 * Request's, an Opportunity's and a Task's screen — at weight 650, behind
 * `projects:read`. It reads `GET /projects/records/:kind/:id/project` and shows
 * the Project's number, title and current Stage with a link; a 404 — the
 * record is in no Project, or in one the reader may not see — renders
 * nothing at all. The zone renderer filters the contribution out before its
 * chunk loads while `projects` is off or the reader lacks the code.
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

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const projects = await import('@endora-commerce/mod-projects/admin');
const REGISTRY = [{ moduleId: 'projects', contributions: projects.contributions }];
const RECORD_ID = '00000000-0000-4000-8000-0000000000c7';

const ZONES = [
  { zone: 'order.detail.sidebar', kind: 'order', props: { orderId: RECORD_ID } },
  { zone: 'quote_request.detail.sidebar', kind: 'quote_request', props: { quoteRequestId: RECORD_ID } },
  { zone: 'opportunity.detail.sidebar', kind: 'opportunity', props: { opportunityId: RECORD_ID } },
  { zone: 'task.detail.after', kind: 'task', props: { taskId: RECORD_ID } },
] as const;

let answer: () => Promise<unknown>;

function renderZone(
  entry: (typeof ZONES)[number],
  options: { permissions?: readonly string[]; present?: readonly string[] } = {},
): HTMLElement {
  cleanup();
  const { container } = renderProjects(<AdminZone name={entry.zone as AdminZoneName} props={entry.props as never} />, {
    permissions: options.permissions ?? ['projects:read'],
    present: options.present ?? ['projects'],
    contributions: REGISTRY,
  });
  return container;
}

beforeEach(() => {
  getSpy.mockReset();
  answer = () => Promise.resolve({ data: summary({ number: 'PRJ-000042', title: 'Warehouse fit-out' }) });
  getSpy.mockImplementation((path: string) =>
    path.startsWith('/api/v1/admin/projects/records/') ? answer() : Promise.reject(new Error(`unexpected GET ${path}`)),
  );
});

describe('projects contributes the Project panel', () => {
  it('declares one contribution per record screen, at weight 650, on projects:read, behind a dynamic import', () => {
    for (const { zone } of ZONES) {
      const found = (projects.contributions.zones ?? []).filter((entry) => entry.zone === zone);
      expect(found, zone).toHaveLength(1);
      expect(found[0]?.weight).toBe(650);
      expect(found[0]?.requiredPermission).toBe('projects:read');
      expect(typeof found[0]?.component).toBe('function');
    }
  });

  for (const entry of ZONES) {
    it(`${entry.zone}: names the Project — number, title, current Stage — with a link to it`, async () => {
      renderZone(entry);
      const heading = await screen.findByRole('heading', { name: en('panel.title') });
      const panel = heading.closest('section') as HTMLElement;
      const link = within(panel).getByRole('link', { name: /PRJ-000042/ });
      expect(link).toHaveAttribute('href', `/projects/${PROJECT_ID}`);
      expect(within(panel).getByText('Warehouse fit-out')).toBeInTheDocument();
      expect(within(panel).getByText('Design')).toBeInTheDocument();
      expect(getSpy).toHaveBeenCalledWith(`/api/v1/admin/projects/records/${entry.kind}/${RECORD_ID}/project`);
    });
  }

  it('writes the Stage deadline as the admin writes every date — the medium date of the UI language (#1567)', async () => {
    renderZone(ZONES[2]);
    const heading = await screen.findByRole('heading', { name: en('panel.title') });
    const panel = heading.closest('section') as HTMLElement;
    // `2026-11-05`, not `11/5/2026` beside the Tasks panel's `Nov 22, 2026`.
    expect(within(panel).getByText(en('panel.deadline', { date: 'Nov 5, 2026' }))).toBeInTheDocument();
  });

  it('renders nothing at all for a record in no Project, or in one the reader may not see (404)', async () => {
    answer = () =>
      Promise.reject(new ApiError(404, { error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } }));
    const container = renderZone(ZONES[0]);
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.innerHTML).toBe('');
  });

  it('says so in its own card when the Project cannot be read for another reason', async () => {
    answer = () => Promise.reject(new Error('offline'));
    renderZone(ZONES[1]);
    expect(await screen.findByText(en('panel.error'))).toBeInTheDocument();
  });

  it('is not there — and asks nothing — while projects is off, or for a reader without projects:read', async () => {
    const off = renderZone(ZONES[0], { present: [] });
    const refused = renderZone(ZONES[0], { permissions: ['orders:read'] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(off.innerHTML).toBe('');
    expect(refused.innerHTML).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });
});
