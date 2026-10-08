import type {
  OpportunityDetail,
  OpportunityStatusRef,
  OpportunityWorkflow,
} from '@endora-commerce/contracts';

/** Which way a move goes, seen from the status the Opportunity is in. */
export type StageSide = 'back' | 'forward' | 'unsorted';

export interface StageModel {
  /** Moves to a status that comes earlier in the operator's order — reopening included. */
  back: OpportunityStatusRef[];
  /** Moves to a status that comes later, and every move that closes the Opportunity. */
  forward: OpportunityStatusRef[];
  /** Moves whose direction is not known: the workflow's order could not be read. */
  unsorted: OpportunityStatusRef[];
}

/**
 * What the stage bar shows for an Opportunity, as data: **the moves the
 * workflow allows from where it is, and nothing else**, sorted into the ones
 * that go back and the ones that go forward.
 *
 * The workflow is the operator's and it is a graph, not a line, so the bar
 * draws no line. The moves are `allowedTransitions` — the server's answer —
 * and are never added to or filtered. Only their *side* is decided here:
 *
 * - a move into a closing status (won, lost) is **forward**, whatever its
 *   weight: closing is where a workflow leads;
 * - a move out of a closing status into an open one is **back**: it reopens;
 * - between two open statuses the operator's own order decides — `weight`, then
 *   `code`, the order of the workflow screen and of the board's columns.
 *
 * The first two need no workflow. The third does, and the Opportunity's own
 * answer does not carry weights; when the workflow could not be read, or does
 * not hold one of the two statuses, the move is `unsorted` — offered all the
 * same, without a direction this screen would have to guess.
 *
 * Within a side the moves are in the operator's order where it is known, and
 * in the server's order otherwise.
 */
export function stageModel(
  opportunity: Pick<OpportunityDetail, 'status' | 'allowedTransitions'>,
  workflow: Pick<OpportunityWorkflow, 'statuses'> | null,
): StageModel {
  const current = opportunity.status;
  const ordered = [...(workflow?.statuses ?? [])].sort(
    (a, b) => a.weight - b.weight || a.code.localeCompare(b.code),
  );
  const rank = new Map(ordered.map((status, index) => [status.code, index]));
  const currentRank = rank.get(current.code);

  const sideOf = (target: OpportunityStatusRef): StageSide => {
    if (target.kind !== 'open') return 'forward';
    if (current.kind !== 'open') return 'back';
    const targetRank = rank.get(target.code);
    if (currentRank === undefined || targetRank === undefined) return 'unsorted';
    return targetRank < currentRank ? 'back' : 'forward';
  };

  const model: StageModel = { back: [], forward: [], unsorted: [] };
  // Stable: targets of equal (unknown) rank keep the order the server gave them.
  const targets = opportunity.allowedTransitions
    .map((target, index) => ({ target, index, rank: rank.get(target.code) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank || a.index - b.index;
      return a.index - b.index;
    });
  for (const { target } of targets) model[sideOf(target)].push(target);
  return model;
}
