/**
 * `runSave` — the one orchestrator behind every adopting editor's Save (feature 180,
 * `specs/180-one-save-zone-editors/contracts/save-participation.md` §4; FR-011…FR-016;
 * owner rulings OQ-1 = A, OQ-2 = A; research R5).
 *
 * A pure async function over an ordered list of parts. The host passes its own write first,
 * `blocking`, then its session's dirty participants in zone order. Two phases:
 *
 *  1. **Validate every part, concurrently**, so every error shows at once. Any refusal ends the
 *     run with outcome `refused`, and no `save` is called — a Save refused by any check sends
 *     zero writing requests (SC-003).
 *  2. **Write the parts one after another**, in the order given. A `blocking` part that fails
 *     stops the run: nothing after it is attempted (the host's own write, FR-015). A
 *     non-blocking part that fails is recorded and the next part still runs (OQ-1 = A);
 *     `stopOnFailure` makes every part blocking — one option, not a second code path.
 *
 * Each part writes through its own module's API, as that module writes today (Principle XIII):
 * nothing here merges two parts into one request.
 */

/** What every `validate` and `save` is handed. */
export interface SaveContext {
  readonly signal: AbortSignal;
}

/** A part's problems: field key → translated message, and an optional part-level message. */
export interface ParticipantIssues {
  readonly fields: Readonly<Record<string, string>>;
  readonly message?: string;
}

/** One part of a Save: the host's own write, or one participant. */
export interface SavePart {
  readonly id: string;
  /** Translated, e.g. "Product fields", "Base prices". */
  readonly label: string;
  /** A blocking part that fails stops the run; the host's own write is blocking. */
  readonly blocking: boolean;
  /** The part's unsaved changes, for the outcome's wording. Defaults to 1. */
  readonly count?: number;
  /** Every check, local and the module's server pre-check. An empty result passes. */
  validate(ctx: SaveContext): Promise<ParticipantIssues>;
  /** Write the part; throw to fail it. */
  save(ctx: SaveContext): Promise<void>;
}

export type SavePartResult = 'saved' | 'refused' | 'failed' | 'not-attempted';

/** One part of a {@link SaveOutcome}, in write order. */
export interface SaveOutcomePart {
  readonly id: string;
  readonly label: string;
  readonly result: SavePartResult;
  readonly count: number;
  /** The part-level message of a refusal or a failure. */
  readonly message?: string;
  /** The refusal's or the failure's issues. */
  readonly issues?: ParticipantIssues;
}

/**
 * `refused`: a check stopped it, nothing written. `failed`: nothing written because the write
 * that failed was the first one to run. `partial`: at least one part written and one not.
 */
export interface SaveOutcome {
  readonly result: 'saved' | 'refused' | 'partial' | 'failed';
  readonly parts: readonly SaveOutcomePart[];
}

export interface RunSaveOptions {
  /** Every part blocking (OQ-1 B's shape, kept as an option). */
  readonly stopOnFailure?: boolean;
  readonly signal?: AbortSignal;
  /** Turn a thrown error into issues; defaults to the error's message. */
  readonly describeError?: (error: unknown) => ParticipantIssues;
}

/** Whether a validation result refuses. */
export function hasIssues(issues: ParticipantIssues): boolean {
  return Object.keys(issues.fields).length > 0 || issues.message !== undefined;
}

function defaultDescribeError(error: unknown): ParticipantIssues {
  return { fields: {}, message: error instanceof Error ? error.message : String(error) };
}

function partOf(
  part: SavePart,
  result: SavePartResult,
  issues?: ParticipantIssues,
): SaveOutcomePart {
  return {
    id: part.id,
    label: part.label,
    result,
    count: part.count ?? 1,
    ...(issues?.message === undefined ? {} : { message: issues.message }),
    ...(issues === undefined ? {} : { issues }),
  };
}

export async function runSave(
  parts: readonly SavePart[],
  options: RunSaveOptions = {},
): Promise<SaveOutcome> {
  if (parts.length === 0) return { result: 'saved', parts: [] };
  const ctx: SaveContext = { signal: options.signal ?? new AbortController().signal };
  const describe = options.describeError ?? defaultDescribeError;

  // Phase 1 — every check, all at once.
  const checks = await Promise.all(
    parts.map(async (part): Promise<ParticipantIssues | null> => {
      try {
        const issues = await part.validate(ctx);
        return hasIssues(issues) ? issues : null;
      } catch (error) {
        return describe(error);
      }
    }),
  );
  if (checks.some((issues) => issues !== null)) {
    return {
      result: 'refused',
      parts: parts.map((part, index) => {
        const issues = checks[index] ?? null;
        return issues === null ? partOf(part, 'not-attempted') : partOf(part, 'refused', issues);
      }),
    };
  }

  // Phase 2 — the writes, in order.
  const outcome: SaveOutcomePart[] = [];
  let stopped = false;
  for (const part of parts) {
    if (stopped) {
      outcome.push(partOf(part, 'not-attempted'));
      continue;
    }
    try {
      await part.save(ctx);
      outcome.push(partOf(part, 'saved'));
    } catch (error) {
      outcome.push(partOf(part, 'failed', describe(error)));
      if (part.blocking || options.stopOnFailure === true) stopped = true;
    }
  }
  const saved = outcome.filter((part) => part.result === 'saved').length;
  const result = saved === outcome.length ? 'saved' : saved === 0 ? 'failed' : 'partial';
  return { result, parts: outcome };
}
