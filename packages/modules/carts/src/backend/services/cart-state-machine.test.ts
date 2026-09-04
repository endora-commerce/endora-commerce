import { describe, expect, it } from 'vitest';
import {
  derivePrimaryCta,
  nextApprovalState,
  shouldReArmOnBuyerMutation,
} from './cart-state-machine.js';
import type { CartApprovalStatus, CartStatus } from '../entities/cart.entity.js';

/**
 * Feature 027 T084 / T085 — pure state-machine unit tests for the
 * cart's two-axis state (main status × approval status).
 *
 * The matrix below mirrors the invariants documented in
 * `docs/docs/modules/carts.md` and the lifecycle ASCII diagram in the
 * spec. Running this suite without a database keeps the iteration loop
 * fast and catches accidental drift between the service implementation
 * and the documented FSM.
 */

describe('nextApprovalState', () => {
  it('submit: not_required → pending (the only legal source)', () => {
    expect(nextApprovalState('not_required', 'submit')).toEqual({ ok: true, next: 'pending' });
  });

  it.each(['pending', 'approved'] as const)(
    'submit refuses when already initiated (from=%s)',
    (from) => {
      expect(nextApprovalState(from, 'submit')).toEqual({
        ok: false,
        reason: 'already_initiated',
      });
    },
  );

  it('approve: pending → approved (only)', () => {
    expect(nextApprovalState('pending', 'approve')).toEqual({ ok: true, next: 'approved' });
    expect(nextApprovalState('not_required', 'approve')).toEqual({ ok: false, reason: 'not_pending' });
    expect(nextApprovalState('approved', 'approve')).toEqual({ ok: false, reason: 'not_pending' });
  });

  it('reject: pending → rejected_by_org_admin (only)', () => {
    expect(nextApprovalState('pending', 'reject')).toEqual({
      ok: true,
      next: 'rejected_by_org_admin',
    });
    expect(nextApprovalState('not_required', 'reject')).toEqual({ ok: false, reason: 'not_pending' });
    expect(nextApprovalState('approved', 'reject')).toEqual({ ok: false, reason: 'not_pending' });
  });

  it('buyer_mutation re-arms only an approved cart', () => {
    expect(nextApprovalState('approved', 'buyer_mutation')).toEqual({
      ok: true,
      next: 'pending',
    });
    for (const from of ['not_required', 'pending'] as const) {
      expect(nextApprovalState(from, 'buyer_mutation')).toEqual({
        ok: false,
        reason: 'not_applicable',
      });
    }
  });

  it('policy_off resets pending and approved back to not_required', () => {
    expect(nextApprovalState('pending', 'policy_off')).toEqual({ ok: true, next: 'not_required' });
    expect(nextApprovalState('approved', 'policy_off')).toEqual({ ok: true, next: 'not_required' });
    expect(nextApprovalState('not_required', 'policy_off')).toEqual({
      ok: false,
      reason: 'not_applicable',
    });
  });

  it('policy_on never auto-flips an existing approval state', () => {
    for (const from of ['not_required', 'pending', 'approved'] as const) {
      expect(nextApprovalState(from, 'policy_on')).toEqual({
        ok: false,
        reason: 'not_applicable',
      });
    }
  });

  it('rejected_by_org_admin is terminal on the approval axis', () => {
    const allEvents = [
      'submit',
      'approve',
      'reject',
      'buyer_mutation',
      'policy_off',
      'policy_on',
    ] as const;
    for (const event of allEvents) {
      expect(nextApprovalState('rejected_by_org_admin', event)).toEqual({
        ok: false,
        reason: 'already_terminal',
      });
    }
  });
});

describe('derivePrimaryCta', () => {
  it.each([
    ['completed', 'not_required'],
    ['completed', 'pending'],
    ['completed', 'approved'],
    ['completed', 'rejected_by_org_admin'],
    ['rejected', 'not_required'],
    ['rejected', 'pending'],
    ['rejected', 'approved'],
    ['rejected', 'rejected_by_org_admin'],
  ] as const)(
    'terminal main status (%s, %s) → blocked_by_organization',
    (status, approvalStatus) => {
      expect(
        derivePrimaryCta({
          status: status as CartStatus,
          approvalStatus: approvalStatus as CartApprovalStatus,
        }),
      ).toBe('blocked_by_organization');
    },
  );

  it('active + pending → awaiting_approval', () => {
    expect(derivePrimaryCta({ status: 'active', approvalStatus: 'pending' })).toBe(
      'awaiting_approval',
    );
  });

  it('active + rejected_by_org_admin → blocked_by_organization', () => {
    expect(
      derivePrimaryCta({ status: 'active', approvalStatus: 'rejected_by_org_admin' }),
    ).toBe('blocked_by_organization');
  });

  it('active + not_required + policy-off → checkout', () => {
    expect(
      derivePrimaryCta({ status: 'active', approvalStatus: 'not_required' }),
    ).toBe('checkout');
    expect(
      derivePrimaryCta({
        status: 'active',
        approvalStatus: 'not_required',
        requiresApproval: false,
      }),
    ).toBe('checkout');
  });

  it('active + not_required + policy-on → submit_for_approval', () => {
    expect(
      derivePrimaryCta({
        status: 'active',
        approvalStatus: 'not_required',
        requiresApproval: true,
      }),
    ).toBe('submit_for_approval');
  });

  it('active + approved → checkout (approved buyer can complete checkout)', () => {
    expect(
      derivePrimaryCta({ status: 'active', approvalStatus: 'approved' }),
    ).toBe('checkout');
    expect(
      derivePrimaryCta({
        status: 'active',
        approvalStatus: 'approved',
        requiresApproval: true,
      }),
    ).toBe('checkout');
  });

  it('abandoned + active-approval-status → checkout (the storefront page touches the cart to reactivate it)', () => {
    // Reactivation is the responsibility of the route handler — the
    // CTA derivation itself only blocks terminal main statuses.
    expect(
      derivePrimaryCta({ status: 'abandoned', approvalStatus: 'not_required' }),
    ).toBe('checkout');
  });
});

describe('shouldReArmOnBuyerMutation', () => {
  it('re-arms only an approved cart', () => {
    expect(shouldReArmOnBuyerMutation('approved')).toBe(true);
    expect(shouldReArmOnBuyerMutation('not_required')).toBe(false);
    expect(shouldReArmOnBuyerMutation('pending')).toBe(false);
    expect(shouldReArmOnBuyerMutation('rejected_by_org_admin')).toBe(false);
  });
});
