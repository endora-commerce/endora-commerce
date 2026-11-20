import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
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
        canModerate
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
        canModerate
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
        canModerate
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
        canModerate
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
        canModerate
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

    // Issue #1474 — the kit's labelled dialog, and a reason with a visible label.
    const dialog = screen.getByRole('dialog', { name: 'organizations.moderation.modal.reject.title' });
    const textarea = within(dialog).getByLabelText('organizations.moderation.modal.reasonRequired');
    expect(textarea).toBeRequired();
    await user.type(textarea, 'Niezweryfikowane dane.');

    expect(confirm).not.toBeDisabled();
    await user.click(confirm);

    expect(postSpy).toHaveBeenCalledWith(
      '/api/v1/admin/organizations/org-42/reject',
      { expectedVersion: 2, reason: 'Niezweryfikowane dane.' },
    );
  });
});

/**
 * Issue #1468 (SALES-01, DEC-07) — moderation is the organization status's one writer, and its
 * routes require `customers:manage`. A reader without it sees the status and the reason, and is
 * offered no action that the server would refuse.
 */
describe('ModerationActionsPanel — without customers:manage (#1468)', () => {
  it('renders no action, and keeps the badge and the reason for readers', () => {
    renderWithI18n(
      <ModerationActionsPanel
        organizationId="org-1"
        status="blocked"
        version={5}
        blockedReason="Past-due AR"
        canModerate={false}
        onChanged={onChangedSpy}
      />,
      { core: { ...BUNDLE['core'], 'organizationStatusBadge.blocked': 'organizationStatusBadge.blocked' } },
    );
    for (const action of ['approve', 'reject', 'block', 'unblock']) {
      expect(screen.queryByRole('button', { name: `organizations.moderation.action.${action}` })).toBeNull();
    }
    expect(screen.getByText(/Past-due AR/)).toBeDefined();
    expect(screen.getByText('organizations.moderation.title')).toBeDefined();
    // The status badge, which stays for readers.
    expect(screen.getByText('organizationStatusBadge.blocked')).toBeDefined();
  });
});


describe('ModerationActionsPanel — registry divergence notice (feature 173, T060)', () => {
  const NOTICE_BUNDLE = {
    ...BUNDLE,
    organizations: {
      'moderation.registryDivergence': 'Fields differing from the registry: {count}.',
      'moderation.registryDivergenceLink': 'Go to VAT validation',
    },
  };

  it('a pending organization with differing fields gets a polite status, icon and text, linking to the VAT panel', () => {
    renderWithI18n(
      <ModerationActionsPanel
        organizationId="org-1"
        status="pending_verification"
        version={0}
        registryDivergenceCount={2}
        vatValidationAnchorId="organization-vat-validation"
        canModerate
        onChanged={onChangedSpy}
      />,
      NOTICE_BUNDLE,
    );
    // It arrives after the VAT history loads, so it must not interrupt (role="alert").
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Fields differing from the registry: 2.');
    expect(notice.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Go to VAT validation' })).toHaveAttribute(
      'href',
      '#organization-vat-validation',
    );
  });

  it('no notice once the organization is no longer pending', () => {
    renderWithI18n(
      <ModerationActionsPanel
        organizationId="org-1"
        status="active"
        version={1}
        registryDivergenceCount={2}
        canModerate
        onChanged={onChangedSpy}
      />,
      NOTICE_BUNDLE,
    );
    expect(screen.queryByText(/differing from the registry/)).toBeNull();
  });
});
