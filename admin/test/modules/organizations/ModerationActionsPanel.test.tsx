import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Feature 026 US1 — interaction test for ModerationActionsPanel.
 *
 * Drives the React component through jsdom + @testing-library/react.
 * Mocks `apiClient.post` so the panel never hits the network; verifies
 * the button-gating rules (which transitions are offered per status)
 * and the modal flow (Approve = no reason; Reject = required reason).
 */

const postSpy = vi.fn();
const onChangedSpy = vi.fn();

// **Re-keyed by feature 091's Phase 4 batch 14, and this is the trap that has
// now met seven merge requests in a row.** The mock named `@/lib/api-client`
// while the subject was under `admin/src`; the subject is inside a module
// package now and resolves `@endora-commerce/admin-kit/lib`, of which
// `@/lib/api-client` is only a re-export shim — so the old spelling intercepted
// nothing and vitest reported that by making the mock **inert** rather than by
// failing. `tsc` cannot see it: both specifiers compile. A programmatic sweep
// of every mock against the file's own imports is what found it.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ModerationActionsPanel } = await import(
  '../../../../packages/modules/organizations/src/admin/panels/ModerationActionsPanel'
);

const BUNDLE = passthroughBundle('core', [
  'common.action.cancel',
  'organizations.moderation.title',
  'organizations.moderation.action.approve',
  'organizations.moderation.action.reject',
  'organizations.moderation.action.block',
  'organizations.moderation.action.unblock',
  'organizations.moderation.success.approve',
  'organizations.moderation.success.reject',
  'organizations.moderation.modal.approve.title',
  'organizations.moderation.modal.approve.description',
  'organizations.moderation.modal.approve.confirm',
  'organizations.moderation.modal.reject.title',
  'organizations.moderation.modal.reject.description',
  'organizations.moderation.modal.reject.confirm',
  'organizations.moderation.modal.reasonRequired',
  'organizations.moderation.modal.reasonOptional',
  'organizations.moderation.error.reasonRequired',
  'organizations.moderation.error.conflict',
  'organizations.moderation.error.wrongStatus',
  'organizations.moderation.error.unknown',
  'organizations.moderation.blockedReasonLabel',
  'organizations.moderation.rejectedReasonLabel',
]);

beforeEach(() => {
  postSpy.mockReset();
  onChangedSpy.mockReset();
  postSpy.mockResolvedValue({ data: { status: 'active', version: 1 } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ModerationActionsPanel — interaction', () => {
  it('only Approve + Reject are enabled for pending_verification', () => {
    renderWithI18n(
      <ModerationActionsPanel
        organizationId="org-1"
        status="pending_verification"
        version={0}
        onChanged={onChangedSpy}
      />,
      BUNDLE,
    );

    expect(
      screen.getByRole('button', { name: 'organizations.moderation.action.approve' }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'organizations.moderation.action.reject' }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'organizations.moderation.action.block' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'organizations.moderation.action.unblock' }),
    ).toBeDisabled();
  });

  it('only Block is enabled for active status', () => {
    renderWithI18n(
      <ModerationActionsPanel
        organizationId="org-1"
        status="active"
        version={3}
        onChanged={onChangedSpy}
      />,
      BUNDLE,
    );
    expect(
      screen.getByRole('button', { name: 'organizations.moderation.action.approve' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'organizations.moderation.action.block' }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'organizations.moderation.action.unblock' }),
    ).toBeDisabled();
  });

  it('only Unblock is enabled for blocked status', () => {
    renderWithI18n(
      <ModerationActionsPanel
        organizationId="org-1"
        status="blocked"
        version={5}
        blockedReason="Past-due AR"
        onChanged={onChangedSpy}
      />,
      BUNDLE,
    );
    expect(
      screen.getByRole('button', { name: 'organizations.moderation.action.unblock' }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'organizations.moderation.action.block' }),
    ).toBeDisabled();
    expect(screen.getByText(/Past-due AR/)).toBeDefined();
  });

  it('clicking Approve calls POST /approve and refreshes the parent', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <ModerationActionsPanel
        organizationId="org-42"
        status="pending_verification"
        version={7}
        onChanged={onChangedSpy}
      />,
      BUNDLE,
    );

    await user.click(
      screen.getByRole('button', { name: 'organizations.moderation.action.approve' }),
    );

    expect(postSpy).toHaveBeenCalledWith(
      '/api/v1/admin/organizations/org-42/approve',
      { expectedVersion: 7 },
    );
    expect(onChangedSpy).toHaveBeenCalledTimes(1);
  });

  it('Reject requires a reason — the Confirm button is disabled until the textarea is non-empty', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <ModerationActionsPanel
        organizationId="org-42"
        status="pending_verification"
        version={2}
        onChanged={onChangedSpy}
      />,
      BUNDLE,
    );

    await user.click(
      screen.getByRole('button', { name: 'organizations.moderation.action.reject' }),
    );

    const confirm = screen.getByRole('button', {
      name: 'organizations.moderation.modal.reject.confirm',
    });
    expect(confirm).toBeDisabled();

    const textarea = screen.getByPlaceholderText(
      'organizations.moderation.modal.reasonRequired',
    );
    await user.type(textarea, 'Niezweryfikowane dane.');

    expect(confirm).not.toBeDisabled();
    await user.click(confirm);

    expect(postSpy).toHaveBeenCalledWith(
      '/api/v1/admin/organizations/org-42/reject',
      { expectedVersion: 2, reason: 'Niezweryfikowane dane.' },
    );
  });
});
