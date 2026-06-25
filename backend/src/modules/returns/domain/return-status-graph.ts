/**
 * Return/complaint status graph — pure domain (feature 046, US3).
 *
 * The RMA case lifecycle is admin-configurable (FR-010..FR-014): a set of
 * statuses and a set of allowed directed transitions between them. This module
 * holds the pure, DB-free representation and validation logic, mirroring the
 * orders module's `domain/order-status-graph.ts`. The DB-backed loader
 * (`ReturnStatusGraphService`) builds a `ReturnStatusGraph` from persisted rows;
 * this value object answers "is this transition allowed?" and enforces the
 * structural invariants (single initial status, terminal statuses have no exit).
 *
 * Unlike the orders graph, the returns graph has no universal `on_hold` edge —
 * the default flow is linear (new → authorized → received → resolved → closed)
 * with rejection and cancellation as terminal off-ramps (data-model.md).
 */

export interface ReturnStatusDef {
  code: string;
  /** Localized labels, e.g. { en: 'New', pl: 'Nowe' }. */
  name: Record<string, string>;
  /** Language-independent fallback (resolution: name[lang] → defaultName → code). */
  defaultName: string;
  isInitial: boolean;
  isTerminal: boolean;
  /** System statuses are protected from deletion. */
  isSystem: boolean;
  weight: number;
  /** Badge colour as a `#rrggbb` hex value. */
  color: string;
}

/**
 * Resolve a status's display label for a viewer's active language, falling back
 * to the language-independent default name, then the code.
 */
export function resolveReturnStatusName(
  def: { name: Record<string, string>; defaultName?: string | null; code: string },
  language: string,
): string {
  return def.name[language] ?? (def.defaultName || undefined) ?? def.code;
}

export interface ReturnTransitionDef {
  fromStatusCode: string;
  toStatusCode: string;
  /** Seeded default edges. */
  isSystem: boolean;
}

export const RETURN_STATUS_INITIAL = 'new';
export const RETURN_STATUS_AUTHORIZED = 'authorized';
export const RETURN_STATUS_RECEIVED = 'received';
export const RETURN_STATUS_RESOLVED = 'resolved';
export const RETURN_STATUS_REJECTED = 'rejected';
export const RETURN_STATUS_CLOSED = 'closed';
export const RETURN_STATUS_CANCELLED = 'cancelled';

/** The default statuses shipped on install (data-model.md). */
export const DEFAULT_RETURN_STATUSES: ReturnStatusDef[] = [
  { code: 'new', name: { en: 'New', pl: 'Nowe' }, defaultName: 'New', isInitial: true, isTerminal: false, isSystem: true, weight: 10, color: '#64748b' },
  { code: 'authorized', name: { en: 'Authorized', pl: 'Autoryzowane' }, defaultName: 'Authorized', isInitial: false, isTerminal: false, isSystem: true, weight: 20, color: '#3b82f6' },
  { code: 'received', name: { en: 'Received', pl: 'Odebrane' }, defaultName: 'Received', isInitial: false, isTerminal: false, isSystem: true, weight: 30, color: '#8b5cf6' },
  { code: 'resolved', name: { en: 'Resolved', pl: 'Rozliczone' }, defaultName: 'Resolved', isInitial: false, isTerminal: false, isSystem: true, weight: 40, color: '#10b981' },
  { code: 'rejected', name: { en: 'Rejected', pl: 'Odrzucone' }, defaultName: 'Rejected', isInitial: false, isTerminal: true, isSystem: true, weight: 50, color: '#ef4444' },
  { code: 'closed', name: { en: 'Closed', pl: 'Zamknięte' }, defaultName: 'Closed', isInitial: false, isTerminal: true, isSystem: true, weight: 60, color: '#10b981' },
  { code: 'cancelled', name: { en: 'Cancelled', pl: 'Anulowane' }, defaultName: 'Cancelled', isInitial: false, isTerminal: true, isSystem: true, weight: 70, color: '#ef4444' },
];

/** The default transitions (User Story 3). */
export const DEFAULT_EXPLICIT_TRANSITIONS: ReadonlyArray<readonly [string, string]> = [
  ['new', 'authorized'],
  ['new', 'rejected'],
  ['new', 'cancelled'],
  ['authorized', 'received'],
  ['authorized', 'cancelled'],
  ['authorized', 'rejected'],
  ['received', 'resolved'],
  ['received', 'rejected'],
  ['resolved', 'closed'],
];

/** The full default transition set. */
export function computeDefaultTransitions(): ReturnTransitionDef[] {
  return DEFAULT_EXPLICIT_TRANSITIONS.map(([from, to]) => ({
    fromStatusCode: from,
    toStatusCode: to,
    isSystem: true,
  }));
}

export class ReturnStatusConfigError extends Error {}

/**
 * Immutable, validated view of the configurable lifecycle. Build it once per
 * read, then ask it questions.
 */
export class ReturnStatusGraph {
  private readonly byCode: Map<string, ReturnStatusDef>;
  private readonly adjacency: Map<string, Set<string>>;

  constructor(
    public readonly statuses: ReturnStatusDef[],
    public readonly transitions: ReturnTransitionDef[],
  ) {
    this.byCode = new Map(statuses.map((s) => [s.code, s]));
    this.adjacency = new Map();
    for (const t of transitions) {
      const set = this.adjacency.get(t.fromStatusCode) ?? new Set<string>();
      set.add(t.toStatusCode);
      this.adjacency.set(t.fromStatusCode, set);
    }
  }

  has(code: string): boolean {
    return this.byCode.has(code);
  }

  get(code: string): ReturnStatusDef | undefined {
    return this.byCode.get(code);
  }

  isTerminal(code: string): boolean {
    return this.byCode.get(code)?.isTerminal ?? false;
  }

  isInitial(code: string): boolean {
    return this.byCode.get(code)?.isInitial ?? false;
  }

  /** The single initial status code (always `new` in the default seed). */
  initialCode(): string {
    const initial = this.statuses.find((s) => s.isInitial);
    if (!initial) throw new ReturnStatusConfigError('No initial return status configured.');
    return initial.code;
  }

  /** Allowed target codes from `from`, sorted by status weight. */
  allowedTargets(from: string): string[] {
    const targets = [...(this.adjacency.get(from) ?? new Set<string>())];
    return targets.sort((a, b) => (this.byCode.get(a)?.weight ?? 0) - (this.byCode.get(b)?.weight ?? 0));
  }

  /**
   * True iff both endpoints exist, `from` is not terminal, and a configured
   * edge `from → to` exists (FR-012).
   */
  canTransition(from: string, to: string): boolean {
    if (!this.byCode.has(from) || !this.byCode.has(to)) return false;
    if (this.isTerminal(from)) return false;
    return this.adjacency.get(from)?.has(to) ?? false;
  }

  /**
   * Structural validation of a candidate config (used by the admin CRUD path
   * before persisting): exactly one initial status, no edge leaves a terminal
   * status, every edge endpoint exists.
   */
  assertValid(): void {
    const initials = this.statuses.filter((s) => s.isInitial);
    if (initials.length !== 1) {
      throw new ReturnStatusConfigError(`Exactly one initial status required, found ${initials.length}.`);
    }
    if (!this.statuses.some((s) => s.isTerminal)) {
      throw new ReturnStatusConfigError('At least one terminal status is required.');
    }
    for (const t of this.transitions) {
      if (!this.byCode.has(t.fromStatusCode) || !this.byCode.has(t.toStatusCode)) {
        throw new ReturnStatusConfigError(
          `Transition references unknown status: ${t.fromStatusCode} → ${t.toStatusCode}.`,
        );
      }
      if (this.isTerminal(t.fromStatusCode)) {
        throw new ReturnStatusConfigError(`Terminal status "${t.fromStatusCode}" cannot have outgoing transitions.`);
      }
    }
  }
}

export function buildDefaultReturnGraph(): ReturnStatusGraph {
  return new ReturnStatusGraph(DEFAULT_RETURN_STATUSES.map((s) => ({ ...s })), computeDefaultTransitions());
}
