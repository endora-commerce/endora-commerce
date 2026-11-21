import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectTemplateSummary } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { en, renderProjects } from './projects-fixtures';

/**
 * The Templates list (`specs/163-projects-and-tasks/`, User Story 3 — task
 * T078; `contracts/admin-surfaces.md` §2, `/projects/settings/templates`): each
 * Template by name with its number of Stages, archived ones only on request
 * and marked as such, and the way to a new one.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { TemplatesList } = await import('../../../../packages/modules/projects/src/admin/pages/TemplatesList');

const ACTIVE: ProjectTemplateSummary = {
  id: '00000000-0000-4000-8000-0000000007a1',
  name: 'Showroom fit-out',
  stageCount: 3,
  archivedAt: null,
  updatedAt: '2026-10-21T10:00:00.000Z',
};
const ARCHIVED: ProjectTemplateSummary = {
  id: '00000000-0000-4000-8000-0000000007a2',
  name: 'Retired kiosk',
  stageCount: 1,
  archivedAt: '2026-10-22T10:00:00.000Z',
  updatedAt: '2026-10-22T10:00:00.000Z',
};

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/projects/templates?active=true') return Promise.resolve({ data: [ACTIVE] });
    if (path === '/api/v1/admin/projects/templates') return Promise.resolve({ data: [ACTIVE, ARCHIVED] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

function render(): void {
  renderProjects(<TemplatesList />, {
    permissions: ['projects:read', 'projects:configure'],
    path: '/projects/settings',
  });
}

describe('TemplatesList', () => {
  it('lists the active Templates, each linked to its editor, with the way to a new one', async () => {
    render();
    const link = await screen.findByRole('link', { name: 'Showroom fit-out' });
    expect(link.getAttribute('href')).toBe(`/projects/settings/templates/${ACTIVE.id}`);
    expect(screen.getByText(en('templates.list.stageCount', { count: 3 }))).toBeTruthy();
    expect(screen.queryByText('Retired kiosk')).toBeNull();
    expect(screen.getByRole('link', { name: new RegExp(en('templates.list.new')) }).getAttribute('href')).toBe(
      '/projects/settings/templates/new',
    );
  });

  it('shows archived Templates on request, marked as archived', async () => {
    render();
    await screen.findByRole('link', { name: 'Showroom fit-out' });
    await userEvent.click(screen.getByRole('checkbox', { name: en('templates.list.showArchived') }));
    const row = (await screen.findByRole('link', { name: 'Retired kiosk' })).closest('tr') as HTMLElement;
    expect(within(row).getByText(en('templates.list.archived'))).toBeTruthy();
  });

  it('says what a Template is for when there is none', async () => {
    getSpy.mockImplementation(() => Promise.resolve({ data: [] }));
    render();
    expect(await screen.findByText(en('templates.list.empty.title'))).toBeTruthy();
  });
});
