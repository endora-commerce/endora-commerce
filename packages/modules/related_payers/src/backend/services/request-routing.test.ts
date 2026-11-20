import { describe, expect, it } from 'vitest';
import { routeRequest, type RoutingInput } from './request-routing.js';

/**
 * `specs/182-related-payers/` T066 (FR-043, FR-044) — where a new request waits, from the
 * approval and unregistered-payer modes **captured on the request** and the tax-ID match.
 */
const ELIGIBLE = { organizationId: 'org-y', eligible: true };
const INELIGIBLE = { organizationId: 'org-z', eligible: false };

function route(over: Partial<RoutingInput>) {
  return routeRequest({ approvalMode: 'payer', unregisteredMode: 'admin', matches: [ELIGIBLE], hasEligibleApprover: true, ...over });
}

describe('routeRequest', () => {
  it.each(['payer', 'payer_then_admin'] as const)('%s, one eligible match with an approver → the counterparty', (approvalMode) => {
    expect(route({ approvalMode })).toEqual({ routing: 'counterparty', counterpartyOrganizationId: 'org-y', operatorReason: null });
  });

  it.each(['payer', 'payer_then_admin'] as const)('%s, one eligible match without an approver → the operator', (approvalMode) => {
    expect(route({ approvalMode, hasEligibleApprover: false })).toEqual({
      routing: 'operator',
      counterpartyOrganizationId: 'org-y',
      operatorReason: 'no_eligible_approver',
    });
  });

  it.each([true, false])('admin → the operator whether or not an approver exists (%s)', (hasEligibleApprover) => {
    expect(route({ approvalMode: 'admin', hasEligibleApprover })).toEqual({
      routing: 'operator',
      counterpartyOrganizationId: 'org-y',
      operatorReason: 'approval_mode_admin',
    });
  });

  it.each(['payer', 'admin', 'payer_then_admin'] as const)('%s, only an ineligible match → the operator', (approvalMode) => {
    expect(route({ approvalMode, matches: [INELIGIBLE] })).toEqual({
      routing: 'operator',
      counterpartyOrganizationId: 'org-z',
      operatorReason: 'ineligible',
    });
  });

  it.each(['payer', 'admin', 'payer_then_admin'] as const)('%s, several matches → the operator, no counterparty', (approvalMode) => {
    expect(route({ approvalMode, matches: [ELIGIBLE, INELIGIBLE] })).toEqual({
      routing: 'operator',
      counterpartyOrganizationId: null,
      operatorReason: 'ambiguous_tax_id',
    });
  });

  it('no match, unregistered mode admin → the operator', () => {
    expect(route({ matches: [], unregisteredMode: 'admin' })).toEqual({
      routing: 'operator',
      counterpartyOrganizationId: null,
      operatorReason: 'no_account',
    });
  });

  it('no match, unregistered mode invite → awaiting registration', () => {
    expect(route({ matches: [], unregisteredMode: 'invite' })).toEqual({
      routing: 'awaiting_registration',
      counterpartyOrganizationId: null,
      operatorReason: null,
    });
  });
});
