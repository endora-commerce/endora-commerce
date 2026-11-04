import { describe, expect, it } from 'vitest';

import {
  EXPECTED_DIFFERENCES,
  type ExpectedDifferenceFamily,
} from '../../fixtures/organization-roles/expected-differences.js';
import {
  ORACLE_REQUESTS,
  PRE_UPGRADE_OUTCOMES,
} from '../../fixtures/organization-roles/pre-upgrade-outcomes.js';

/**
 * The self-check of the roles upgrade's expected differences —
 * `specs/170-organization-roles/` T124 (WP-13a; research R-38;
 * `contracts/migration-and-replay.md` §6.1; owner rulings PR-5, PR-6). Its
 * clause on the interim landing ledger (§6.2) went with the ledger in T112 (WP-13);
 * `landedBy` is provenance from then on.
 *
 * No services: it reads three fixtures, so it runs on every merge request,
 * which the replay that consumes the table does not (D-198). What it holds is
 * that the table cannot drift from the frozen oracle it is a statement about —
 * every `before` is the recorded outcome — and that the allocation of each row
 * to the work package that lands it is the one §6.1 writes down.
 *
 * {@link LANDS_IN} restates §6.1's *Lands in* column by row id, deliberately
 * beside the table rather than derived from it: a row moved to another package
 * in the fixture alone is an allocation nobody wrote into the contract.
 */

/** §6.1's *Lands in* column, row by row (rows 1–26, in the contract's order). */
const LANDS_IN: Readonly<Record<string, 'WP-03' | 'WP-04' | 'WP-06'>> = {
  'members.list:P.owner': 'WP-03',
  'invitations.list:P.owner': 'WP-03',
  'orgCarts.list:P.owner': 'WP-04',
  'orgCarts.read:P.owner': 'WP-04',
  'orgCarts.approve:P.owner': 'WP-04',
  'orgCarts.reject:P.owner': 'WP-04',
  'oneClick.setOrganizationDefaults:P.owner': 'WP-06',
  'mfa.setPolicy:P.owner': 'WP-03',
  'invitation.createMember:P.owner': 'WP-03',
  'invitation.createAdministrator:P.owner': 'WP-03',
  'invitation.revoke:P.owner': 'WP-03',
  'member.remove:P.owner': 'WP-03',
  'member.changeRole:P.owner': 'WP-03',
  'orgCarts.list:A.regular': 'WP-04',
  'orgCarts.list:B.regular': 'WP-04',
  'orgCarts.read:A.regular': 'WP-04',
  'orgCarts.read:B.regular': 'WP-04',
  'orgCarts.approve:A.regular': 'WP-04',
  'orgCarts.approve:B.regular': 'WP-04',
  'orgCarts.reject:A.regular': 'WP-04',
  'orgCarts.reject:B.regular': 'WP-04',
  'cart.submitForApproval:B.admin': 'WP-04',
  'oneClick.eligibility:B.regular': 'WP-06',
  'oneClick.place:B.regular': 'WP-06',
  'invitations.list:A.admin': 'WP-03',
  'invitations.list:B.admin': 'WP-03',
};

/** §6.1 *Families*: how many rows each holds. */
const FAMILY_SIZES: Readonly<Record<ExpectedDifferenceFamily, number>> = {
  F1: 13,
  F2: 8,
  F3: 1,
  F4: 2,
  F5: 2,
};

const entries = Object.entries(EXPECTED_DIFFERENCES);

describe('170 — the expected differences of the roles upgrade (§6.1)', () => {
  it('holds 26 rows in the five families §6.1 counts', () => {
    expect(entries).toHaveLength(26);
    const sizes: Record<string, number> = {};
    for (const [, row] of entries) sizes[row.family] = (sizes[row.family] ?? 0) + 1;
    expect(sizes).toEqual(FAMILY_SIZES);
  });

  it('keys every row by an oracle request id', () => {
    const ids = new Set(ORACLE_REQUESTS.map((r) => r.id));
    expect(entries.map(([id]) => id).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('states every `before` exactly as the frozen oracle recorded it', () => {
    const drifted = entries
      .filter(([id, row]) => JSON.stringify(row.before) !== JSON.stringify(PRE_UPGRADE_OUTCOMES[id]))
      .map(([id, row]) => ({ id, table: row.before, recorded: PRE_UPGRADE_OUTCOMES[id] }));
    expect(drifted).toEqual([]);
  });

  it('gives every row an `after` that differs from its `before`', () => {
    const unchanged = entries
      .filter(([, row]) => JSON.stringify(row.after) === JSON.stringify(row.before))
      .map(([id]) => id);
    expect(unchanged).toEqual([]);
  });

  it('makes F4 exactly the rows tagged `oneClickInApprovalOrg` (PR-6)', () => {
    const f4 = entries
      .filter(([, row]) => row.family === 'F4')
      .map(([id]) => id)
      .sort();
    const tagged = ORACLE_REQUESTS.filter((r) => r.tags?.includes('oneClickInApprovalOrg'))
      .map((r) => r.id)
      .sort();
    expect(f4).toEqual(tagged);
  });

  it('allocates every row to the package §6.1 says lands it', () => {
    const allocation = Object.fromEntries(entries.map(([id, row]) => [id, row.landedBy]));
    expect(allocation).toEqual(LANDS_IN);
  });
});
