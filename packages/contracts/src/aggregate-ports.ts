import { z } from 'zod';

/**
 * `specs/186-aggregate-ports/` (D-293, `data-model.md` § *AggregateCommandOptions*) —
 * the shared vocabulary of the aggregate write ports (`<aggregate>CommandPort`,
 * `specs/conventions/module-composition.md` item 2a).
 */

/**
 * What a server-side caller may hand any aggregate write-port method besides its
 * input — the method's last parameter.
 *
 * - `extensions` — extension input for the command-hook modules on the method's
 *   action, keyed by module id; each hook sees only its own key. A key no present
 *   hook module claims is refused `422 COMMAND_EXTENSION_UNCLAIMED` before
 *   anything is written (`specs/176-command-hooks-outbox/`).
 * - `expectedVersion` — the aggregate `version` the caller read. Honoured where
 *   the aggregate has a `version` its admin route checks: a row that has moved on
 *   is refused `409 VERSION_CONFLICT`. A port whose aggregate has none says in
 *   its JSDoc that the member is ignored.
 * - `source` — a code naming the integration that called
 *   ({@link aggregateCommandSourceSchema}), recorded as `source` in the Command's
 *   audit `stateAfter`. With no administrator the actor is `system`, and this
 *   code is what tells integrations apart (D-293.6: there is no `automation`
 *   actor kind). A code outside the pattern is refused `422 VALIDATION_FAILED`
 *   before anything is written.
 */
export interface AggregateCommandOptions {
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly expectedVersion?: number;
  readonly source?: string;
}

/**
 * The shape of {@link AggregateCommandOptions.source}: a lower-case code of at
 * most 64 characters — an id, never free text (`specs/conventions/audit-state.md`
 * list 1).
 */
export const aggregateCommandSourceSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/);

/**
 * The caller's read-modify-write over an aggregate's custom-field bag, run by
 * the owner between its own load and its own write, inside one Command. The
 * owner does not validate: the caller calls
 * `CustomFieldValuePort.validateAndMerge` inside it, and a refusal it throws
 * propagates unchanged and writes nothing.
 */
export type CustomFieldMerge = (current: Record<string, unknown>) => Promise<Record<string, unknown>>;
