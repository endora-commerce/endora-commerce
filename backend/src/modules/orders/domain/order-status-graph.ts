/**
 * Order status graph — pure domain (feature 038, US1).
 *
 * The order lifecycle is admin-configurable (FR-001/FR-006): a set of statuses
 * and a set of allowed directed transitions between them. This module holds the
 * pure, DB-free representation and validation logic. The DB- and Redis-backed
 * loader (`OrderStatusGraphService`) builds an `OrderStatusGraph` from persisted
 * rows; this value object answers "is this transition allowed?" and enforces the
 * structural invariants (single initial status, terminal statuses have no exit).
 *
 * Two special statuses get universal edges materialized at seed time and
 * whenever a non-terminal status is added (data-model.md §2):
 *   - `on_hold`: reachable FROM every non-terminal status, and a source TO every
 *     other status.
 *   - `cancelled`: reachable FROM every non-terminal status; terminal itself.
 */

import {
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_INITIAL,
  ORDER_STATUS_ON_HOLD,
} from '@b2b/contracts';

export interface OrderStatusDef {
  code: string;
  /** Localized labels, e.g. { en: 'New', pl: 'Nowy' }. */
  name: Record<string, string>;
  /**
   * Language-independent fallback used when the viewer's active language has
   * no entry in `name`. Always set (resolution: name[lang] → defaultName → code).
   */
  defaultName: string;
  isInitial: boolean;
  isTerminal: boolean;
  /** System statuses (new, on_hold, cancelled, completed) — `new` is non-deletable. */
  isSystem: boolean;
  weight: number;
  /** Badge colour as a `#rrggbb` hex value; neutral slate by default. */
  color: string;
}

/**
 * Resolve a status's display label for a viewer's active language, falling
 * back to the language-independent default name, then the code (feature 039
 * follow-up). Shared by admin, storefront, and email rendering.
 */
export function resolveOrderStatusName(
  def: { name: Record<string, string>; defaultName?: string | null; code: string },
  language: string,
): string {
  return def.name[language] ?? (def.defaultName || undefined) ?? def.code;
}

export interface OrderTransitionDef {
  fromStatusCode: string;
  toStatusCode: string;
  /** Seeded universal edges (to on_hold / cancelled, out of on_hold). */
  isSystem: boolean;
}

/**
 * The three spellings moved to `@b2b/contracts` in feature 075's Phase P —
 * `payments` compares an order's status against the first of them, and a
 * constant is not port material (FR-013). Re-exported here so this file's own
 * graph logic and the consumers Phase C has not reached keep resolving them.
 */
export { ORDER_STATUS_ON_HOLD, ORDER_STATUS_CANCELLED, ORDER_STATUS_INITIAL };

/** The 9 default statuses shipped on install (data-model.md §1). */
export const DEFAULT_ORDER_STATUSES: OrderStatusDef[] = [
  { code: 'new', name: { en: 'New', pl: 'Nowy' }, defaultName: 'New', isInitial: true, isTerminal: false, isSystem: true, weight: 10, color: '#64748b' },
  { code: 'pending', name: { en: 'Pending', pl: 'Oczekujące' }, defaultName: 'Pending', isInitial: false, isTerminal: false, isSystem: false, weight: 20, color: '#f59e0b' },
  { code: 'paid', name: { en: 'Paid', pl: 'Zapłacone' }, defaultName: 'Paid', isInitial: false, isTerminal: false, isSystem: false, weight: 30, color: '#3b82f6' },
  { code: 'processing', name: { en: 'Processing', pl: 'Przetwarzanie' }, defaultName: 'Processing', isInitial: false, isTerminal: false, isSystem: false, weight: 40, color: '#3b82f6' },
  { code: 'shipment_ready', name: { en: 'Shipment Ready', pl: 'Przesyłka gotowa' }, defaultName: 'Shipment Ready', isInitial: false, isTerminal: false, isSystem: false, weight: 50, color: '#8b5cf6' },
  { code: 'shipment_sent', name: { en: 'Shipment Sent', pl: 'Przesyłka wysłana' }, defaultName: 'Shipment Sent', isInitial: false, isTerminal: false, isSystem: false, weight: 60, color: '#8b5cf6' },
  { code: 'completed', name: { en: 'Completed', pl: 'Zakończone' }, defaultName: 'Completed', isInitial: false, isTerminal: true, isSystem: true, weight: 70, color: '#10b981' },
  { code: 'on_hold', name: { en: 'On Hold', pl: 'Wstrzymane' }, defaultName: 'On Hold', isInitial: false, isTerminal: false, isSystem: true, weight: 80, color: '#f59e0b' },
  { code: 'cancelled', name: { en: 'Cancelled', pl: 'Anulowane' }, defaultName: 'Cancelled', isInitial: false, isTerminal: true, isSystem: true, weight: 90, color: '#ef4444' },
];

/**
 * The explicit (non-universal) default transitions (User Story 1).
 *
 * `new → paid` is the happy path of every gateway payment (feature 085,
 * FR-010): a payment method is seeded `status_on_pending = 'new'` and
 * `status_on_success = 'paid'`, so a first successful payment asks for exactly
 * this move. It was missing here, and the settlement ingress got away with it
 * only because it writes `order.status` directly without asking the graph —
 * while an operator making the same move by hand was refused with a 409.
 */
export const DEFAULT_EXPLICIT_TRANSITIONS: ReadonlyArray<readonly [string, string]> = [
  ['new', 'pending'],
  ['new', 'paid'],
  ['pending', 'processing'],
  ['pending', 'paid'],
  ['paid', 'processing'],
  ['processing', 'shipment_ready'],
  ['shipment_ready', 'shipment_sent'],
  ['paid', 'completed'],
  ['shipment_sent', 'completed'],
];

/**
 * Compute the universal `on_hold` / `cancelled` edges for a status set:
 *   - every non-terminal status (except on_hold itself) → on_hold
 *   - on_hold → every other status
 *   - every non-terminal status (except cancelled) → cancelled
 * Self-edges are never produced.
 */
export function materializeUniversalTransitions(statuses: OrderStatusDef[]): OrderTransitionDef[] {
  const edges: OrderTransitionDef[] = [];
  const push = (from: string, to: string): void => {
    if (from !== to) edges.push({ fromStatusCode: from, toStatusCode: to, isSystem: true });
  };
  for (const s of statuses) {
    if (!s.isTerminal && s.code !== ORDER_STATUS_ON_HOLD) {
      push(s.code, ORDER_STATUS_ON_HOLD);
      push(s.code, ORDER_STATUS_CANCELLED);
    }
  }
  for (const s of statuses) {
    push(ORDER_STATUS_ON_HOLD, s.code);
  }
  return edges;
}

/** The full default transition set: explicit edges + materialized universal edges. */
export function computeDefaultTransitions(): OrderTransitionDef[] {
  const explicit: OrderTransitionDef[] = DEFAULT_EXPLICIT_TRANSITIONS.map(([from, to]) => ({
    fromStatusCode: from,
    toStatusCode: to,
    isSystem: false,
  }));
  const universal = materializeUniversalTransitions(DEFAULT_ORDER_STATUSES);
  return dedupeTransitions([...explicit, ...universal]);
}

function dedupeTransitions(edges: OrderTransitionDef[]): OrderTransitionDef[] {
  const seen = new Map<string, OrderTransitionDef>();
  for (const e of edges) {
    const key = `${e.fromStatusCode}\0${e.toStatusCode}`;
    // Keep the first (explicit edges precede universal ones, so explicit wins).
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.values()];
}

export class OrderStatusConfigError extends Error {}

/**
 * Immutable, validated view of the configurable lifecycle. Build it once per
 * read (the service caches the underlying rows in Redis), then ask it questions.
 */
export class OrderStatusGraph {
  private readonly byCode: Map<string, OrderStatusDef>;
  private readonly adjacency: Map<string, Set<string>>;

  constructor(
    public readonly statuses: OrderStatusDef[],
    public readonly transitions: OrderTransitionDef[],
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

  get(code: string): OrderStatusDef | undefined {
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
    if (!initial) throw new OrderStatusConfigError('No initial order status configured.');
    return initial.code;
  }

  /** Allowed target codes from `from`, sorted by status weight. */
  allowedTargets(from: string): string[] {
    const targets = [...(this.adjacency.get(from) ?? new Set<string>())];
    return targets.sort((a, b) => (this.byCode.get(a)?.weight ?? 0) - (this.byCode.get(b)?.weight ?? 0));
  }

  /**
   * True iff both endpoints exist, `from` is not terminal, and a configured
   * edge `from → to` exists (FR-005 / Scenario 3, 5).
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
      throw new OrderStatusConfigError(`Exactly one initial status required, found ${initials.length}.`);
    }
    for (const t of this.transitions) {
      if (!this.byCode.has(t.fromStatusCode) || !this.byCode.has(t.toStatusCode)) {
        throw new OrderStatusConfigError(
          `Transition references unknown status: ${t.fromStatusCode} → ${t.toStatusCode}.`,
        );
      }
      if (this.isTerminal(t.fromStatusCode)) {
        throw new OrderStatusConfigError(`Terminal status "${t.fromStatusCode}" cannot have outgoing transitions.`);
      }
    }
  }
}

export function buildDefaultGraph(): OrderStatusGraph {
  return new OrderStatusGraph(DEFAULT_ORDER_STATUSES.map((s) => ({ ...s })), computeDefaultTransitions());
}
