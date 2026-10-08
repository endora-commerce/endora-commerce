import type {
  OpportunityDetail,
  OpportunityStatusKind,
  OpportunityWorkflow,
  OpportunityWorkflowStatus,
} from '@endora-commerce/contracts';

/** One status as the bar draws it. */
export interface StageSegment {
  code: string;
  name: string;
  color: string;
  kind: OpportunityStatusKind;
  /** `current` — where the Opportunity is; `target` — a move the workflow allows from there. */
  state: 'current' | 'target' | 'other';
}

export interface StageModel {
  segments: StageSegment[];
  /** The current status's place among the **open** statuses, 1-based; `null` once closed. */
  position: number | null;
  /** How many open statuses the workflow has; `null` when the workflow is not known. */
  total: number | null;
  /** `false` when only the current status and its targets are known. */
  complete: boolean;
}

/**
 * What the stage bar shows for an Opportunity, as data.
 *
 * The workflow is the operator's and it is **a graph, not a line**: any status
 * may lead to any other, and an Opportunity may have skipped half of them. So
 * the model claims only what is true —
 *
 * - the statuses in the operator's own order (weight, then code), **open ones
 *   first and the closing ones after them**, because "won" and "lost" are two
 *   ends and not steps nine and ten of the same road;
 * - which one the Opportunity is in, and which ones `allowedTransitions` — the
 *   server's answer — lets it move to;
 * - a position ("2 of 3") counted over the open statuses only, and none at all
 *   for a closed Opportunity.
 *
 * It never marks an earlier status as "done": nothing here knows the
 * Opportunity passed through it.
 *
 * Without the workflow (the read failed, or the current status is not in it —
 * deleted a moment ago), the bar falls back to the current status and its
 * targets, so every allowed move stays reachable.
 */
export function stageModel(
  opportunity: Pick<OpportunityDetail, 'status' | 'allowedTransitions'>,
  workflow: OpportunityWorkflow | null,
  /** A workflow status's name in the reader's language (`labels.ts`' `workflowStatusLabel`). */
  labelOf: (status: OpportunityWorkflowStatus) => string,
): StageModel {
  const current = opportunity.status;
  const targets = new Map(opportunity.allowedTransitions.map((target) => [target.code, target]));
  const fallback: StageModel = {
    segments: [
      { ...current, state: 'current' },
      ...opportunity.allowedTransitions.map((target) => ({ ...target, state: 'target' as const })),
    ],
    position: null,
    total: null,
    complete: false,
  };
  if (!workflow || !workflow.statuses.some((status) => status.code === current.code)) {
    return fallback;
  }

  const ordered = [...workflow.statuses].sort(
    (a, b) => a.weight - b.weight || a.code.localeCompare(b.code),
  );
  const open = ordered.filter((status) => status.kind === 'open');
  const closing = ordered.filter((status) => status.kind !== 'open');

  const segments: StageSegment[] = [...open, ...closing].map((status) => {
    if (status.code === current.code) return { ...current, state: 'current' };
    const target = targets.get(status.code);
    if (target) return { ...target, state: 'target' };
    return {
      code: status.code,
      name: labelOf(status),
      color: status.color,
      kind: status.kind,
      state: 'other',
    };
  });
  // A target the workflow read does not carry yet is still a move the server allows.
  const known = new Set(segments.map((segment) => segment.code));
  for (const target of opportunity.allowedTransitions) {
    if (!known.has(target.code)) segments.push({ ...target, state: 'target' });
  }

  const index = open.findIndex((status) => status.code === current.code);
  return {
    segments,
    position: index === -1 ? null : index + 1,
    total: open.length,
    complete: true,
  };
}
