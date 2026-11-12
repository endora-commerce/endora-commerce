import type { CommandHookPhase } from '@endora-commerce/contracts';
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
  const byModule = new Map<string, R[]>();
  for (const registration of registrations) {
    const list = byModule.get(registration.moduleId) ?? [];
    list.push(registration);
    byModule.set(registration.moduleId, list);
  }
  for (const list of byModule.values()) list.sort((left, right) => left.seq - right.seq);

  const dependsOn = (module: string, other: string): boolean => (dependencies[module] ?? []).includes(other);
  const declared = tieBreak ?? [];
  const position = (module: string): number => declared.indexOf(module);

  // Ask every pair once, so a refusal is raised however the input arrived —
  // and in one deterministic order, so the same deployment always reports the
  // same pair first.
  const modules = [...byModule.keys()].sort();
  for (let i = 0; i < modules.length; i += 1) {
    for (let j = i + 1; j < modules.length; j += 1) {
      const a = modules[i]!;
      const b = modules[j]!;
      const aFirst = dependsOn(b, a);
      const bFirst = dependsOn(a, b);
      const pa = position(a);
      const pb = position(b);
      const ranked = pa >= 0 && pb >= 0;
      if (aFirst || bFirst) {
        if (ranked && aFirst !== pa < pb) {
          throw new CommandHookOrderContradictionError(action, declared, {
            before: aFirst ? a : b,
            after: aFirst ? b : a,
          });
        }
        continue;
      }
      if (!ranked) {
        const hooks = [...byModule.get(a)!, ...byModule.get(b)!].map((hook) => hookLabel(hook.moduleId, hook.id));
        throw new UnorderedCommandHooksError(action, phase, [a, b], hooks);
      }
    }
  }

  const compare = (a: string, b: string): number => {
    if (a === b) return 0;
    if (dependsOn(b, a)) return -1;
    if (dependsOn(a, b)) return 1;
    return position(a) - position(b);
  };
  return modules.sort(compare).flatMap((module) => byModule.get(module)!);
}
