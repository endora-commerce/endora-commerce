import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Issue #1551 (UX audit SHELL-15) — the subscribe form asks *which
 * organizations* as a two-option choice, *All organizations* or *One
 * organization*, instead of an optional picker under a 305-character
 * paragraph explaining what leaving it empty means. The picker exists only for
 * the second option, and the form cannot be submitted with it empty.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
    },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return {
    ...actual,
    OrganizationPicker: (props: { value: string | null; onChange: (id: string | null) => void }) => (
      <input
        aria-label="mock-org-picker"
        value={props.value ?? ''}
        onChange={(e): void => props.onChange(e.target.value === '' ? null : e.target.value)}
      />
    ),
  };
});

const { default: WebhookCreatePage } = await import(
  '../../../../packages/modules/webhooks/src/admin/pages/WebhookCreatePage'
);

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const ALL = /core\.webhooks\.create\.scope\.all\.label/;
const ONE = /core\.webhooks\.create\.scope\.organization\.label/;

function renderPage(): void {
  renderWithI18n(
    <MemoryRouter initialEntries={['/webhooks/new']}>
      <Routes>
        <Route path="/webhooks/new" element={<WebhookCreatePage />} />
      </Routes>
    </MemoryRouter>,
    { core: {} },
  );
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/core\.webhooks\.create\.nameLabel/), 'ERP feed');
  await user.type(screen.getByLabelText(/core\.webhooks\.create\.urlLabel/), 'https://example.test/hook');
  await user.click(screen.getByRole('checkbox', { name: 'order.created.v1' }));
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockResolvedValue({ data: [] });
  postSpy.mockResolvedValue({ data: { id: 'w1', secret: 'whsec_test' } });
});

describe('the webhook subscribe form — which organizations is a choice (SHELL-15)', () => {
  it('starts on all organizations, with no picker and no paragraph about leaving it empty', async () => {
    renderPage();
    expect(await screen.findByRole('radio', { name: ALL })).toBeChecked();
    expect(screen.getByRole('radio', { name: ONE })).not.toBeChecked();
    expect(screen.queryByLabelText('mock-org-picker')).not.toBeInTheDocument();
    expect(screen.queryByText('core.webhooks.create.organizationHelp')).not.toBeInTheDocument();
  });

  it('posts a platform-wide subscription without an organization', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'core.webhooks.create.submit' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).toEqual({
      name: 'ERP feed',
      url: 'https://example.test/hook',
      eventTypes: ['order.created.v1'],
    });
  });

  it('one organization shows the picker and holds Subscribe until it is chosen', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole('radio', { name: ONE }));

    const submit = screen.getByRole('button', { name: 'core.webhooks.create.submit' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('mock-org-picker'), ORG_ID);
    expect(submit).toBeEnabled();

    await user.click(submit);
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).toEqual({
      name: 'ERP feed',
      url: 'https://example.test/hook',
      eventTypes: ['order.created.v1'],
      organizationId: ORG_ID,
    });
  });

  it('going back to all organizations forgets the chosen organization', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole('radio', { name: ONE }));
    await user.type(screen.getByLabelText('mock-org-picker'), ORG_ID);
    await user.click(screen.getByRole('radio', { name: ALL }));
    await user.click(screen.getByRole('button', { name: 'core.webhooks.create.submit' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).not.toHaveProperty('organizationId');
  });

  it('ends on the signing secret, titled in one line with the receiver note beneath', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'core.webhooks.create.submit' }));
    expect(await screen.findByDisplayValue('whsec_test')).toBeInTheDocument();
    expect(screen.getByText('core.webhooks.revealed.title')).toBeInTheDocument();
    expect(screen.getByText('core.webhooks.revealed.body')).toBeInTheDocument();
  });
});
