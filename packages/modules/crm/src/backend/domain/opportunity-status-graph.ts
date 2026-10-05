/**
 * The Opportunity status workflow — pure domain.
 *
 * A set of statuses and a set of permitted directed transitions between them,
 * both configured at runtime. This file holds the database-free representation
 * and its structural rules; the loader builds an `OpportunityStatusGraph` from
 * the persisted rows and asks it "is this transition allowed?".
 *
 * Modelled on the Order lifecycle's graph, with three deliberate differences:
 * a status has a `kind` (`open | won | lost`) instead of a terminal flag,
 * because closing is an outcome and not only an end; **a closing status may
 * have outgoing transitions**, so reopening is a transition like any other;
 * and there are no system statuses and no universal edges.
 */

export type OpportunityStatusKind = 'open' | 'won' | 'lost';

export interface OpportunityStatusDef {
  code: string;
  /** Localized labels, e.g. `{ en: 'New', pl: 'Nowa' }`. */
  name: Record<string, string>;
  /** Fallback when the viewer's language has no entry in `name`. */
  defaultName: string;
  kind: OpportunityStatusKind;
  isInitial: boolean;
  weight: number;
  /** Badge colour as a `#rrggbb` hex value. */
  color: string;
}

export interface OpportunityTransitionDef {
  fromStatusCode: string;
  toStatusCode: string;
}

/**
 * The structural rules of a workflow, by name. The name is what a refused
 * configuration write reports, so an operator's screen can say which rule a
 * change would break.
 */
export type OpportunityWorkflowRule =
  | 'exactly_one_initial'
  | 'initial_must_be_open'
  | 'won_status_required'
  | 'lost_status_required'
  | 'transition_unknown_status';

export class OpportunityWorkflowConfigError extends Error {
  constructor(
    readonly rule: OpportunityWorkflowRule,
    message: string,
  ) {
    super(message);
    this.name = 'OpportunityWorkflowConfigError';
  }
}

/** A status's label for a viewer's language: `name[language]`, the default name, the code. */
export function resolveOpportunityStatusName(
  def: { name: Record<string, string>; defaultName?: string | null; code: string },
  language: string,
): string {
  return def.name[language] ?? (def.defaultName || undefined) ?? def.code;
}

/** An immutable view of the configured workflow. Build one per operation and ask it. */
export class OpportunityStatusGraph {
  private readonly byCode: Map<string, OpportunityStatusDef>;
  private readonly adjacency: Map<string, Set<string>>;

  constructor(
    public readonly statuses: readonly OpportunityStatusDef[],
    public readonly transitions: readonly OpportunityTransitionDef[],
  ) {
    this.byCode = new Map(statuses.map((status) => [status.code, status]));
    this.adjacency = new Map();
    for (const transition of transitions) {
      const targets = this.adjacency.get(transition.fromStatusCode) ?? new Set<string>();
      targets.add(transition.toStatusCode);
      this.adjacency.set(transition.fromStatusCode, targets);
    }
  }

  has(code: string): boolean {
    return this.byCode.has(code);
  }

  get(code: string): OpportunityStatusDef | undefined {
    return this.byCode.get(code);
  }

  /** `undefined` for a code that is not a configured status. */
  kindOf(code: string): OpportunityStatusKind | undefined {
    return this.byCode.get(code)?.kind;
  }

  /** The one initial status. Throws when the workflow does not have exactly one. */
  initial(): OpportunityStatusDef {
    const initials = this.statuses.filter((status) => status.isInitial);
    const [only] = initials;
    if (initials.length !== 1 || only === undefined) {
      throw new OpportunityWorkflowConfigError(
        'exactly_one_initial',
        `Exactly one initial status is required, found ${initials.length}.`,
      );
    }
    return only;
  }

  /** The configured targets of `from`, ordered by status weight. */
  allowedTargets(from: string): string[] {
    const weightOf = (code: string): number => this.byCode.get(code)?.weight ?? 0;
    return [...(this.adjacency.get(from) ?? [])]
      .filter((code) => this.byCode.has(code))
      .sort((a, b) => weightOf(a) - weightOf(b));
  }

  /**
   * True when both ends are configured statuses and the edge `from → to`
   * exists. The kind of `from` is not consulted: a closing status moves on
   * wherever an edge says it may.
   */
  canTransition(from: string, to: string): boolean {
    if (!this.byCode.has(from) || !this.byCode.has(to)) return false;
    return this.adjacency.get(from)?.has(to) ?? false;
  }

  /**
   * The structural rules, checked before a configuration write is persisted:
   * exactly one initial status and it is open; at least one won and one lost
   * status; every transition names two configured statuses.
   */
  assertValid(): void {
    const initial = this.initial();
    if (initial.kind !== 'open') {
      throw new OpportunityWorkflowConfigError(
        'initial_must_be_open',
        `The initial status "${initial.code}" must be an open status.`,
      );
    }
    if (!this.statuses.some((status) => status.kind === 'won')) {
      throw new OpportunityWorkflowConfigError(
        'won_status_required',
        'At least one status that closes an opportunity as won is required.',
      );
    }
    if (!this.statuses.some((status) => status.kind === 'lost')) {
      throw new OpportunityWorkflowConfigError(
        'lost_status_required',
        'At least one status that closes an opportunity as lost is required.',
      );
    }
    for (const transition of this.transitions) {
      if (!this.byCode.has(transition.fromStatusCode) || !this.byCode.has(transition.toStatusCode)) {
        throw new OpportunityWorkflowConfigError(
          'transition_unknown_status',
          `A transition names a status that is not configured: ${transition.fromStatusCode} → ${transition.toStatusCode}.`,
        );
      }
    }
  }
}
