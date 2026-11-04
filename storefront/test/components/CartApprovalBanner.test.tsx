import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CartApprovalBanner } from '../../components/CartApprovalBanner';

/**
 * Feature 027 US4 — SSR contract for CartApprovalBanner.
 *
 * Five variants (`specs/170-organization-roles/` FR-057: the submit prompt follows the cart's
 * `primaryCta`, the backend's verdict from the member's role — never an Organization flag):
 *   1. status='not_required' + primaryCta='checkout'            → renders nothing
 *   2. status='not_required' + primaryCta='submit_for_approval' → "submit for approval" CTA
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
  submissionRequired: 'Your role requires approval of this cart.',
  submitButton: 'Submit for approval',
};

describe('CartApprovalBanner — SSR rendering', () => {
  it('renders empty when the CTA is checkout and approval is not_required', () => {
    const html = renderToString(
      <CartApprovalBanner
        approvalStatus="not_required"
        primaryCta="checkout"
        rejectedReason={null}
        submitForApprovalAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toBe('');
  });

  it('renders the "submit for approval" CTA when the CTA says so', () => {
    const html = renderToString(
      <CartApprovalBanner
        approvalStatus="not_required"
        primaryCta="submit_for_approval"
        rejectedReason={null}
        submitForApprovalAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Your role requires approval of this cart');
    expect(html).toContain('Submit for approval');
  });

  it('renders the pending notice', () => {
    const html = renderToString(
      <CartApprovalBanner
        approvalStatus="pending"
        primaryCta="awaiting_approval"
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
        primaryCta="checkout"
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
        primaryCta="checkout"
        rejectedReason="Out of budget"
        submitForApprovalAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Rejected: Out of budget');
  });
});
