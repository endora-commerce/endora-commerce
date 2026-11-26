import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { Card, CardContent, EditorSection } from '@endora-commerce/admin-kit/ui';
import { setMobileViewport } from '../../setup';
import { markup } from '../../helpers/react-ids';
import { PROJECT_ID, ROLES, core, detail, en, renderProjects } from './projects-fixtures';

/**
 * `project.detail.after` and `project.detail.sidebar` — the two places another
 * module adds to a Project's screen (issue #1905), on the terms of the order's
 * and the quote request's members of the same names.
 *
 * `projects` mounts each zone once, hands it the Project's id and knows
 * nothing of who fills it. A sidebar contribution is a section of one card
 * beside the tabs; an `.after` contribution is a card of its own after them.
 * **With nobody contributing — the contributor switched off, or a reader
 * without its permission — the rendered screen is the one without the zones,
 * byte for byte.** The contributors here are stand-ins.
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

const { ProjectDetail } = await import('../../../../packages/modules/projects/src/admin/pages/ProjectDetail');

function FirstProbe({ projectId }: { projectId: string }): ReactNode {
  return <EditorSection title="First probe">{`first for ${projectId}`}</EditorSection>;
}
function SecondProbe({ projectId }: { projectId: string }): ReactNode {
  return <EditorSection title="Second probe">{`second for ${projectId}`}</EditorSection>;
}
function AfterProbe({ projectId }: { projectId: string }): ReactNode {
  return (
    <Card>
      <CardContent>
        <section aria-label="After probe">{`after for ${projectId}`}</section>
      </CardContent>
    </Card>
  );
}

/** Stand-in contributors behind a permission of their own, the sidebar's declared out of weight order. */
const PROBE: AdminContributions = {
  zones: [
    zoneComponent('project.detail.sidebar', () => Promise.resolve({ default: SecondProbe }), {
      weight: 200,
      requiredPermission: 'probe:read',
    }),
    zoneComponent('project.detail.sidebar', () => Promise.resolve({ default: FirstProbe }), {
      weight: 100,
      requiredPermission: 'probe:read',
    }),
    zoneComponent('project.detail.after', () => Promise.resolve({ default: AfterProbe }), {
      weight: 100,
      requiredPermission: 'probe:read',
    }),
  ],
};
const REGISTRY = [{ moduleId: 'blog', contributions: PROBE }];

const PROJECTS_PRESENT = ['projects', 'organizations', 'admin_users'];
const PROJECTS_PERMISSIONS = ['projects:read', 'projects:write', 'organizations:read', 'admin_users:read'];

async function renderDetail(options: {
  readonly registry: typeof REGISTRY | [];
  readonly permissions: readonly string[];
  readonly present: readonly string[];
}): Promise<HTMLElement> {
  cleanup();
  const { container } = renderProjects(<ProjectDetail />, {
    path: `/projects/${PROJECT_ID}`,
    pattern: '/projects/:id',
    permissions: options.permissions,
    present: options.present,
    contributions: options.registry,
  });
  await screen.findByRole('heading', { level: 1, name: /Warehouse fit-out/ });
  // The tab is a lazy component.
  const panel = await screen.findByRole('tabpanel');
  await waitFor(() => expect(within(panel).queryByText(core('common.state.loading'))).toBeNull());
  return container;
}

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/projects/${PROJECT_ID}`) return Promise.resolve({ data: detail() });
    if (path === '/api/v1/admin/projects/roles') return Promise.resolve({ data: ROLES });
    return Promise.resolve({ data: [] });
  });
});

describe('ProjectDetail — the project.detail.sidebar zone', () => {
  it('renders the contributions as sections of one sidebar card beside the tabs, in weight order', async () => {
    await renderDetail({
      registry: REGISTRY,
      permissions: [...PROJECTS_PERMISSIONS, 'probe:read'],
      present: [...PROJECTS_PRESENT, 'blog'],
    });
    const aside = await screen.findByRole('complementary', { name: en('detail.sidebar.label') });
    const second = await within(aside).findByRole('region', { name: 'Second probe' });
    const first = within(aside).getByRole('region', { name: 'First probe' });
    expect(first).toHaveTextContent(`first for ${PROJECT_ID}`);
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Sections of the one sidebar card: no card in a card.
    expect(aside.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
    // Beside the tabs, after them in reading order: the main content comes first on a narrow screen.
    const tabs = screen.getByRole('tablist', { name: en('tabs.label') });
    expect(tabs.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('ProjectDetail — the project.detail.after zone', () => {
  it('renders a contribution as a card of its own after the tabs', async () => {
    const container = await renderDetail({
      registry: REGISTRY,
      permissions: [...PROJECTS_PERMISSIONS, 'probe:read'],
      present: [...PROJECTS_PRESENT, 'blog'],
    });
    const after = await screen.findByRole('region', { name: 'After probe' });
    expect(after).toHaveTextContent(`after for ${PROJECT_ID}`);
    expect(screen.queryByRole('complementary', { name: en('detail.sidebar.label') })?.contains(after)).toBe(false);
    const tabs = screen.getByRole('tablist', { name: en('tabs.label') });
    expect(tabs.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Last on the screen.
    expect(container.lastElementChild?.contains(after)).toBe(true);
  });
});

describe('ProjectDetail — both zones with nobody contributing', () => {
  it('is identical to the screen with nobody contributing when the contributor is switched off', async () => {
    const baseline = markup(
      await renderDetail({ registry: [], permissions: [...PROJECTS_PERMISSIONS, 'probe:read'], present: PROJECTS_PRESENT }),
    );
    const off = markup(
      await renderDetail({
        registry: REGISTRY,
        permissions: [...PROJECTS_PERMISSIONS, 'probe:read'],
        present: PROJECTS_PRESENT,
      }),
    );
    expect(off).toBe(baseline);
    expect(off).not.toContain('probe');
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('is identical to it for somebody without the contribution’s permission', async () => {
    const baseline = markup(
      await renderDetail({ registry: [], permissions: PROJECTS_PERMISSIONS, present: [...PROJECTS_PRESENT, 'blog'] }),
    );
    const refused = markup(
      await renderDetail({ registry: REGISTRY, permissions: PROJECTS_PERMISSIONS, present: [...PROJECTS_PRESENT, 'blog'] }),
    );
    expect(refused).toBe(baseline);
  });

  it('leaves the host naming no contributor', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../packages/modules/projects/src/admin/pages/ProjectDetail.tsx'),
      'utf8',
    );
    expect(source).toContain('<AdminZone name="project.detail.sidebar" props={{ projectId: project.id }} chrome="section" />');
    expect(source).toContain('<AdminZone name="project.detail.after" props={{ projectId: project.id }} chrome="card" />');
    expect(source).not.toMatch(/mod-crm|mod-tasks|OpportunityPanel|TasksPanel/);
  });
});
