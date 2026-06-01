import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CartApprovalBanner } from '../../components/CartApprovalBanner';

/**
 * Feature 027 US4 — SSR contract for CartApprovalBanner.
 *
 * Five variants:
 *   1. status='not_required' + policyOff → renders nothing
 *   2. status='not_required' + policyOn  → "submit for approval" CTA
 *   3. status='pending'                  → pending notice
 *   4. status='approved'                 → approved notice
 *   5. status='rejected_by_org_admin'    → rejection notice with reason
 */

const noopAction = async (): Promise<void> => undefined;

const STRINGS = {
  pending: 'Awaiting approval.',
  approved: 'Approved, ready for checkout.',
  rejected: (reason: string | null) =>
    reason ? `Rejected: ${reason}` : 'Rejected.',
  policyOn: 'Your organization requires cart approval.',
  submitButton: 'Submit for approval',
};

describe('CartApprovalBanner — SSR rendering', () => {
  it('renders empty when policy is off and approval is not_required', () => {
    const html = renderToString(
      <CartApprovalBanner
        approvalStatus="not_required"
        policyOn={false}
        rejectedReason={null}
        submitForApprovalAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toBe('');
  });

  it('renders the "submit for approval" CTA when policy is on but not_required', () => {
    const html = renderToString(
      <CartApprovalBanner
        approvalStatus="not_required"
        policyOn={true}
        rejectedReason={null}
        submitForApprovalAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Your organization requires cart approval');
    expect(html).toContain('Submit for approval');
  });

  it('renders the pending notice', () => {
    const html = renderToString(
      <CartApprovalBanner
        approvalStatus="pending"
        policyOn={true}
        rejectedReason={null}
        submitForApprovalAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Awaiting approval');
    expect(html).not.toContain('Submit for approval');
  });

  it('renders the approved notice', () => {
    const html = renderToString(
      <CartApprovalBanner
        approvalStatus="approved"
        policyOn={true}
        rejectedReason={null}
        submitForApprovalAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Approved, ready for checkout');
  });

  it('renders the rejection notice with the reason', () => {
    const html = renderToString(
      <CartApprovalBanner
        approvalStatus="rejected_by_org_admin"
        policyOn={true}
        rejectedReason="Out of budget"
        submitForApprovalAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Rejected: Out of budget');
  });
});
