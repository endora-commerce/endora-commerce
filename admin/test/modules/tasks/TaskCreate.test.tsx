import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { setMobileViewport } from '../../setup';
import { ME_ID, core, en, renderTasks, taskDetail } from './tasks-fixtures';

/**
 * Creating a Task (`specs/163-projects-and-tasks/`, User Story 2 — task T067).
 *
 * A Task created here belongs to no record: a Project's Tasks are created on
 * the Project's own *Tasks* tab, into a Stage. A title is required and said to
 * be; nothing is sent without one; the new Task opens.
 */

const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(() => Promise.resolve({ data: [] })),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

/** Where the screen went: the path and query of the Task route. */
function Where(): ReactNode {
  const location = useLocation();
  return <p>{`${location.pathname}${location.search}`}</p>;
}

const { TaskCreate } = await import('../../../../packages/modules/tasks/src/admin/pages/TaskCreate');

beforeEach(() => {
  setMobileViewport(false);
  postSpy.mockReset();
});

function renderPage(): void {
  renderTasks(
    <Routes>
      <Route path="/tasks/new" element={<TaskCreate />} />
      <Route path="/tasks/:id" element={<p>task screen</p>} />
    </Routes>,
    { path: '/tasks/new' },
  );
}

describe('TaskCreate', () => {
  it('refuses to send without a title, and says so', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: en('create.submit') }));
    expect(screen.getByText(en('create.error.title'))).toBeTruthy();
    // Focus goes to the invalid field, whose description is the error (WCAG 3.3.1, #512).
    const title = screen.getByLabelText(new RegExp(en('field.title')));
    await waitFor(() => expect(title).toHaveFocus());
    expect(title).toHaveAccessibleDescription(en('create.error.title'));
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('shows busy only on the button that was pressed (#512)', async () => {
    postSpy.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await userEvent.type(await screen.findByLabelText(new RegExp(en('field.title'))), 'Think it over');
    await userEvent.click(screen.getByRole('button', { name: en('create.saveDraft') }));
    expect(screen.getByRole('button', { name: en('create.saveDraft') })).toHaveAttribute('aria-busy', 'true');
    const create = screen.getByRole('button', { name: en('create.submit') });
    expect(create).toBeDisabled();
    expect(create).not.toHaveAttribute('aria-busy', 'true');
  });

  it('leads Back, and on to the new Task, to the screen it was opened from (`?returnTo=`, #512)', async () => {
    postSpy.mockResolvedValue({ data: taskDetail() });
    renderTasks(
      <Routes>
        <Route path="/tasks/new" element={<TaskCreate />} />
        <Route path="/tasks/:id" element={<Where />} />
      </Routes>,
      { path: `/tasks/new?returnTo=${encodeURIComponent('/orders/o-1')}` },
    );
    expect(await screen.findByRole('link', { name: core('common.action.back') })).toHaveAttribute('href', '/orders/o-1');
    await userEvent.type(screen.getByLabelText(new RegExp(en('field.title'))), 'Call the buyer');
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    expect(await screen.findByText(`/tasks/${taskDetail().id}?returnTo=${encodeURIComponent('/orders/o-1')}`)).toBeTruthy();
  });

  it('ignores a returnTo that is not a path of this application', async () => {
    renderTasks(
      <Routes>
        <Route path="/tasks/new" element={<TaskCreate />} />
      </Routes>,
      { path: `/tasks/new?returnTo=${encodeURIComponent('//evil.example')}` },
    );
    expect(await screen.findByRole('link', { name: en('create.back') })).toHaveAttribute('href', '/tasks');
  });

  it('links the description’s hint to the field, and names the tag picker by its visible label (T092)', async () => {
    renderPage();
    const description = await screen.findByLabelText(en('field.description'));
    // The field adds its own shortcut hint after it.
    expect(description).toHaveAccessibleDescription(expect.stringContaining(en('field.descriptionHint')));
    const tags = screen.getByRole('button', { name: en('field.tags') });
    expect(tags).not.toHaveAttribute('aria-label');
    expect(document.getElementById(tags.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(en('field.tags'));
  });

  it('creates a Task with the fields filled, assigned to the caller, and opens it', async () => {
    postSpy.mockResolvedValue({ data: taskDetail() });
    renderPage();
    await userEvent.type(await screen.findByLabelText(new RegExp(en('field.title'))), 'Order the racking');
    await userEvent.type(screen.getByLabelText(en('field.description')), 'Three bays.');
    await userEvent.type(screen.getByLabelText(en('field.dueOn')), '2026-11-05');
    await userEvent.click(screen.getByRole('button', { name: en('detail.assignToMe') }));
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/tasks', {
      title: 'Order the racking',
      description: 'Three bays.',
      dueOn: '2026-11-05',
      assigneeIds: [ME_ID],
    });
    expect(await screen.findByText('task screen')).toBeTruthy();
  });
});

/**
 * Issue #1449 (UX audit 2026-11-17, DS-19; WORK-16) — every create form ends with the kit's
 * sticky save bar: in view while the form scrolls, the secondary action first and the one
 * primary last (Von Restorff, Jakob).
 */
describe('TaskCreate — the sticky save bar (#1449)', () => {
  it('ends the form with Save draft, then Create last', async () => {
    renderPage();
    const bar = (await screen.findByRole('button', { name: en('create.submit') })).closest<HTMLElement>('[data-slot="sticky-form-actions"]');
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute('data-desktop', 'sticky');
    expect(
      within(bar!)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual([en('create.saveDraft'), en('create.submit')]);
    expect(bar!.closest('form')!.lastElementChild).toBe(bar);
  });
});
