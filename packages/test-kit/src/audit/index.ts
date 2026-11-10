/**
 * `./audit` — the sentinel assertion of `specs/conventions/audit-state.md` §6
 * (D-288, issue #470).
 *
 * The platform audit log is a global table read under one permission, so for a
 * tenant-scoped record a Command's `stateBefore` / `stateAfter` carry names and
 * structure, never values. A module proves that by seeding every value-bearing
 * field with a distinctive sentinel, running the Command through the real
 * `CommandBus`, and handing what the audit port recorded to
 * {@link expectNoAuditValues}.
 *
 * One helper rather than one per module, because the sweep is a dozen pull
 * requests and the check has to mean the same thing in each: a sentinel at any
 * depth, under an object key, in another case, or a number written as a decimal
 * string, is a leak.
 *
 * It depends on `node:assert` and nothing else, so it needs no test runner of
 * its own: an `AssertionError` is what every runner reports as a failed
 * expectation.
 */
import { AssertionError } from 'node:assert';

/** An audited state, as the audit port records it or as a Command or a history answers it. */
type State = Record<string, unknown> | null | undefined;

/**
 * Anything that carries an audited state: a `RecordAuditInput`, an
 * `AuditLogEntry`, a row of `GET /admin/audit-log` (`stateBefore` /
 * `stateAfter`), or a Command outcome / history entry (`before` / `after`).
 */
export interface AuditStateCarrier {
  readonly action?: string | null;
  readonly stateBefore?: State;
  readonly stateAfter?: State;
  readonly before?: unknown;
  readonly after?: unknown;
}

/**
 * A value seeded into a field the audit log must not carry. Choose it so that
 * nothing legitimate contains it — `'S470-TITLE'`, `470470.47` — a sentinel as
 * short as `5` would match counts and versions.
 */
export type AuditSentinel = string | number;

/** One sentinel found in one place. */
export interface AuditValueLeak {
  /** The index of the entry in the list given. */
  readonly entry: number;
  readonly action: string | null;
  /** `stateAfter.customFieldValues.risk`, `before.tags[0]`; a key is written `{key}`. */
  readonly path: string;
  readonly sentinel: AuditSentinel;
}

const SIDES = ['stateBefore', 'stateAfter', 'before', 'after'] as const;

function matches(text: string, sentinel: AuditSentinel): boolean {
  if (typeof sentinel === 'number') return text.includes(String(sentinel));
  return text.toLowerCase().includes(sentinel.toLowerCase());
}

function leafMatches(value: unknown, sentinel: AuditSentinel): boolean {
  if (typeof value === 'number') return typeof sentinel === 'number' ? value === sentinel : false;
  if (typeof value === 'string') return matches(value, sentinel);
  if (typeof value === 'bigint') return matches(value.toString(), sentinel);
  return false;
}

function walk(
  value: unknown,
  path: string,
  sentinels: readonly AuditSentinel[],
  found: (path: string, sentinel: AuditSentinel) => void,
): void {
  if (value === null || value === undefined) return;
  if (value instanceof Date) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, sentinels, found));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      for (const sentinel of sentinels) {
        if (typeof sentinel === 'string' && matches(key, sentinel)) found(`${path}{${key}}`, sentinel);
      }
      walk(child, `${path}.${key}`, sentinels, found);
    }
    return;
  }
  for (const sentinel of sentinels) if (leafMatches(value, sentinel)) found(path, sentinel);
}

function assertSentinels(sentinels: readonly AuditSentinel[]): void {
  if (sentinels.length === 0) {
    throw new TypeError('expectNoAuditValues: give at least one sentinel; a check for nothing proves nothing.');
  }
  for (const sentinel of sentinels) {
    if (typeof sentinel === 'string' && sentinel.trim() === '') {
      throw new TypeError('expectNoAuditValues: an empty sentinel matches every text; choose a distinctive one.');
    }
    if (typeof sentinel === 'number' && !Number.isFinite(sentinel)) {
      throw new TypeError(`expectNoAuditValues: the sentinel ${String(sentinel)} is not a finite number.`);
    }
  }
}

/**
 * Every place a sentinel appears in the entries' audited states — values at any
 * depth, and object keys. `[]` when there is none.
 */
export function findAuditValues(
  entries: readonly AuditStateCarrier[],
  sentinels: readonly AuditSentinel[],
): AuditValueLeak[] {
  assertSentinels(sentinels);
  const leaks: AuditValueLeak[] = [];
  entries.forEach((entry, index) => {
    for (const side of SIDES) {
      walk(entry[side], side, sentinels, (path, sentinel) => {
        leaks.push({ entry: index, action: entry.action ?? null, path, sentinel });
      });
    }
  });
  return leaks;
}

/**
 * Fail unless the entries carry no sentinel — and unless there **is** an entry:
 * a Command that skipped its audit, or a recording port nobody wired, would
 * otherwise pass for every sentinel there is.
 *
 * This checks values only. That `changedFields` / `changedCustomFields` name
 * what changed is the caller's own assertion, because only the caller knows
 * what its Command changed.
 */
export function expectNoAuditValues(
  entries: readonly AuditStateCarrier[],
  sentinels: readonly AuditSentinel[],
): void {
  assertSentinels(sentinels);
  if (entries.length === 0) {
    throw new AssertionError({
      message:
        'expectNoAuditValues: no audit entry to inspect. Run the Command through the real CommandBus with a recording audit port.',
    });
  }
  const leaks = findAuditValues(entries, sentinels);
  if (leaks.length === 0) return;
  const lines = leaks.map(
    (leak) => `  entry ${leak.entry}${leak.action ? ` (${leak.action})` : ''}: ${leak.path} carries ${JSON.stringify(leak.sentinel)}`,
  );
  throw new AssertionError({
    message:
      `The audit log carries tenant-scoped values (specs/conventions/audit-state.md):\n${lines.join('\n')}\n` +
      'Record the field names in changedFields / changedCustomFields and keep the values in a store the module owns.',
  });
}
