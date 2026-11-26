import type { CommandHookPhase } from '@endora-commerce/contracts';
import { orderByModuleGraph } from '../ordering.js';
import { CommandHookOrderContradictionError, UnorderedCommandHooksError, hookLabel } from './errors.js';

/**
 * The order of one action's hooks (`specs/176-command-hooks-outbox/` FR-013,
 * FR-014, research R-7).
 *
 *  1. A module's hooks run after the hooks of every module it **transitively**
 *     depends on — the manifest graph is the order.
 *  2. Two modules the graph does not rank are ranked by the deployment's
 *     `commandHookOrder[action]` (first runs first), and refused otherwise.
 *     An entry that contradicts the graph is refused: it only breaks ties.
 *  3. One module's hooks keep the order it registered them in.
 *
 * Every pair of modules is therefore ranked, so the comparison below is a total
 * order and the result does not depend on the order the input arrived in
 * (Principle XV: identical inputs, identical order).
 */

/** One registration, as the registry keeps it. `seq` is the global registration order. */
export interface CommandHookRegistration {
  readonly moduleId: string;
  readonly id: string;
  readonly action: string;
  readonly phase: CommandHookPhase;
  readonly handler: (ctx: never) => unknown;
  readonly seq: number;
}

export function orderCommandHooks<R extends CommandHookRegistration>(
  action: string,
  phase: CommandHookPhase,
  registrations: readonly R[],
  dependencies: Readonly<Record<string, readonly string[]>>,
  tieBreak: readonly string[] | undefined,
): R[] {
  // `specs/189-command-middleware/` T008 — the graph order is shared with
  // `admit` middleware; the errors stay hook-specific. Every pair of hook
  // modules on one action and phase must be ranked, so no `requiresOrder`.
  const declared = tieBreak ?? [];
  return orderByModuleGraph(registrations, {
    dependencies,
    tieBreak: declared,
    unordered: (a, b) => {
      const hooks = registrations
        .filter((hook) => hook.moduleId === a || hook.moduleId === b)
        .sort((left, right) => (left.moduleId === right.moduleId ? left.seq - right.seq : left.moduleId === a ? -1 : 1))
        .map((hook) => hookLabel(hook.moduleId, hook.id));
      return new UnorderedCommandHooksError(action, phase, [a, b], hooks);
    },
    contradiction: (before, after) => new CommandHookOrderContradictionError(action, declared, { before, after }),
  });
}
