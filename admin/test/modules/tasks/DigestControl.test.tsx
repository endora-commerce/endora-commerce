import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setMobileViewport } from '../../setup';
import { core, en, renderTasks } from './tasks-fixtures';

/**
 * The *Daily digest* control on *My Tasks* (`specs/165-task-management/` User
 * Story 7 scenario 5, FR-036; `contracts/admin-surfaces.md` §1): off by
 * default, the caller's own, at an hour of the Tasks time zone —
 * `GET` / `PUT` / `DELETE /tasks/me/digest`.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: (...args: unknown[]) => putSpy(...args),
      patch: vi.fn(),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { useDigestDisclosure } = await import('../../../../packages/modules/tasks/src/admin/components/DigestControl');

/** My Tasks' shape: the summary in the header, the panel below it (issue #1563). */
function DigestControl(): ReactNode {
  const digest = useDigestDisclosure();
  return (
    <>
      {digest.trigger}
      {digest.panel}
    </>
  );
}

/** The disclosure starts closed; the control is behind it. */
async function open(summary: string): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: summary }));
}

const DIGEST_PATH = '/api/v1/admin/tasks/me/digest';
let stored: { hour: number } | null = null;

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, putSpy, deleteSpy]) spy.mockReset();
  stored = null;
  getSpy.mockImplementation((path: string) =>
    path === DIGEST_PATH ? Promise.resolve({ data: stored }) : Promise.reject(new Error(`unexpected GET ${path}`)),
  );
  putSpy.mockImplementation((_path: string, body: { hour: number }) => Promise.resolve({ data: { hour: body.hour } }));
  deleteSpy.mockResolvedValue(undefined);
});

const toggle = (): HTMLElement => screen.getByRole('checkbox', { name: en('digest.toggle') });
const hour = (): HTMLElement => screen.getByLabelText(en('digest.hour'));

describe('DigestControl (US7)', () => {
  it('reads the caller’s digest: off by default, with no hour to choose', async () => {
    renderTasks(<DigestControl />);
    await open(en('digest.summary.off'));
    await waitFor(() => expect(toggle()).not.toBeChecked());
    expect(screen.queryByLabelText(en('digest.hour'))).toBeNull();
    expect(getSpy).toHaveBeenCalledWith(DIGEST_PATH);
  });

  it('turns it on at 08:00 by default, then saves a chosen hour with an explicit Save', async () => {
    const user = userEvent.setup();
    renderTasks(<DigestControl />);
    await open(en('digest.summary.off'));
    await waitFor(() => expect(toggle()).toBeEnabled());
    await user.click(toggle());

    await waitFor(() => expect(putSpy).toHaveBeenCalledWith(DIGEST_PATH, { hour: 8 }));
    expect(toggle()).toBeChecked();
    expect(await screen.findByText(en('digest.on', { hour: '08:00' }))).toBeInTheDocument();

    // Nothing to save until the hour differs from the stored one.
    expect(screen.getByRole('button', { name: en('digest.saveHour') })).toBeDisabled();
    // Choosing an hour only stages it: arrow keys on a select must not write once per keypress (WCAG 3.2.2).
    await user.selectOptions(hour(), '7');
    await user.selectOptions(hour(), '6');
    await user.selectOptions(hour(), '7');
    expect(putSpy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: en('digest.saveHour') }));
    await waitFor(() => expect(putSpy).toHaveBeenLastCalledWith(DIGEST_PATH, { hour: 7 }));
    expect(putSpy).toHaveBeenCalledTimes(2);
    // Save is disabled again once saved: focus goes back to the hour it saved (WCAG 2.4.3).
    await waitFor(() => expect(hour()).toHaveFocus());
    expect(await screen.findByText(en('digest.on', { hour: '07:00' }))).toBeInTheDocument();
    // The summary follows what was saved.
    expect(screen.getByRole('button', { name: en('digest.summary.on', { hour: '07:00' }) })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows a stored hour and turns the digest off', async () => {
    stored = { hour: 6 };
    const user = userEvent.setup();
    renderTasks(<DigestControl />);
    await open(en('digest.summary.on', { hour: '06:00' }));
    await waitFor(() => expect(toggle()).toBeChecked());
    expect(hour()).toHaveValue('6');
    await user.click(toggle());

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(DIGEST_PATH));
    expect(toggle()).not.toBeChecked();
    expect(await screen.findByText(en('digest.off'))).toBeInTheDocument();
  });

  it('says so when the digest cannot be read, and offers no control', async () => {
    getSpy.mockImplementation(() => Promise.reject(new Error('down')));
    renderTasks(<DigestControl />);
    await open(en('digest.title'));
    expect(await screen.findByText(en('digest.error'))).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: en('digest.toggle') })).toBeNull();
  });

  it('offers a Retry when the digest cannot be read, and shows the control once it can (#512)', async () => {
    getSpy.mockImplementationOnce(() => Promise.reject(new Error('down')));
    renderTasks(<DigestControl />);
    await open(en('digest.title'));
    expect(await screen.findByText(en('digest.error'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: core('common.action.retry') }));
    await waitFor(() => expect(toggle()).not.toBeChecked());
    expect(screen.queryByText(en('digest.error'))).toBeNull();
    expect(getSpy).toHaveBeenCalledTimes(2);
  });
});
