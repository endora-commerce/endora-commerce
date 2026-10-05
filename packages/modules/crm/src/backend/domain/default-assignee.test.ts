import { describe, expect, it } from 'vitest';
import { pickDefaultAssignee } from './default-assignee.js';

/**
 * The default assignee of a new Opportunity
 * (`specs/143-crm-sales-opportunities/research.md` R-9): among the Sales Reps
 * assigned to the Organization who are active, the creator wins; otherwise the
 * longest-standing assignment; otherwise nobody.
 */
describe('pickDefaultAssignee', () => {
  const at = (day: number) => new Date(Date.UTC(2026, 0, day));
  const A = 'a0000000-0000-4000-8000-000000000001';
  const B = 'b0000000-0000-4000-8000-000000000002';
  const C = 'c0000000-0000-4000-8000-000000000003';

  it('answers the only assigned Sales Rep', () => {
    expect(
      pickDefaultAssignee({
        assignments: [{ adminUserId: A, createdAt: at(1) }],
        activeAdminUserIds: new Set([A]),
        creatorAdminUserId: C,
      }),
    ).toBe(A);
  });

  it('prefers the creator when the creator is among the assigned Sales Reps', () => {
    expect(
      pickDefaultAssignee({
        assignments: [
          { adminUserId: A, createdAt: at(1) },
          { adminUserId: B, createdAt: at(5) },
        ],
        activeAdminUserIds: new Set([A, B]),
        creatorAdminUserId: B,
      }),
    ).toBe(B);
  });

  it('answers the longest-standing assignment when the creator is not among them', () => {
    expect(
      pickDefaultAssignee({
        assignments: [
          { adminUserId: B, createdAt: at(5) },
          { adminUserId: A, createdAt: at(1) },
        ],
        activeAdminUserIds: new Set([A, B]),
        creatorAdminUserId: C,
      }),
    ).toBe(A);
  });

  it('answers the longest-standing assignment when nobody created it (the system did)', () => {
    expect(
      pickDefaultAssignee({
        assignments: [
          { adminUserId: B, createdAt: at(5) },
          { adminUserId: A, createdAt: at(1) },
        ],
        activeAdminUserIds: new Set([A, B]),
        creatorAdminUserId: null,
      }),
    ).toBe(A);
  });

  it('skips an inactive Sales Rep, however long-standing', () => {
    expect(
      pickDefaultAssignee({
        assignments: [
          { adminUserId: A, createdAt: at(1) },
          { adminUserId: B, createdAt: at(5) },
        ],
        activeAdminUserIds: new Set([B]),
        creatorAdminUserId: C,
      }),
    ).toBe(B);
  });

  it('does not prefer a creator who is assigned but inactive', () => {
    expect(
      pickDefaultAssignee({
        assignments: [
          { adminUserId: A, createdAt: at(1) },
          { adminUserId: B, createdAt: at(5) },
        ],
        activeAdminUserIds: new Set([A]),
        creatorAdminUserId: B,
      }),
    ).toBe(A);
  });

  it('breaks a tie on the assignment date by id, so the answer does not depend on row order', () => {
    const one = pickDefaultAssignee({
      assignments: [
        { adminUserId: B, createdAt: at(1) },
        { adminUserId: A, createdAt: at(1) },
      ],
      activeAdminUserIds: new Set([A, B]),
      creatorAdminUserId: null,
    });
    const other = pickDefaultAssignee({
      assignments: [
        { adminUserId: A, createdAt: at(1) },
        { adminUserId: B, createdAt: at(1) },
      ],
      activeAdminUserIds: new Set([A, B]),
      creatorAdminUserId: null,
    });
    expect(one).toBe(A);
    expect(other).toBe(A);
  });

  it('answers null when no Sales Rep is assigned, or none is active', () => {
    expect(
      pickDefaultAssignee({ assignments: [], activeAdminUserIds: new Set([A]), creatorAdminUserId: A }),
    ).toBeNull();
    expect(
      pickDefaultAssignee({
        assignments: [{ adminUserId: A, createdAt: at(1) }],
        activeAdminUserIds: new Set(),
        creatorAdminUserId: A,
      }),
    ).toBeNull();
  });
});
