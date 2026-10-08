/**
 * The default assignee of a new Opportunity — pure
 * (`specs/143-crm-sales-opportunities/research.md` R-9).
 *
 * Applied only when the request does not say who holds the Opportunity. Among
 * the Sales Reps assigned to the Opportunity's Organization who are active:
 *
 * 1. the administrator creating the Opportunity, if they are one of them;
 * 2. otherwise the longest-standing assignment;
 * 3. otherwise nobody — the Opportunity is created unassigned.
 */

export interface SalesRepAssignmentCandidate {
  readonly adminUserId: string;
  /** When the Sales Rep was assigned to the Organization. */
  readonly createdAt: Date;
}

export function pickDefaultAssignee(input: {
  assignments: readonly SalesRepAssignmentCandidate[];
  /** The assigned administrators who may hold an Opportunity today. */
  activeAdminUserIds: ReadonlySet<string>;
  /** `null` when no administrator is creating it — a subscriber is. */
  creatorAdminUserId: string | null;
}): string | null {
  const eligible = input.assignments.filter((assignment) =>
    input.activeAdminUserIds.has(assignment.adminUserId),
  );
  if (eligible.length === 0) return null;
  if (
    input.creatorAdminUserId !== null &&
    eligible.some((assignment) => assignment.adminUserId === input.creatorAdminUserId)
  ) {
    return input.creatorAdminUserId;
  }
  // The id breaks a tie on the date, so the answer never depends on row order.
  const [first] = [...eligible].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.adminUserId.localeCompare(b.adminUserId),
  );
  return first?.adminUserId ?? null;
}
