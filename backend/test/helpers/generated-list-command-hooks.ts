import {
  CommandHookRegistry,
  hookableActionsFrom,
  moduleDependencyClosureFrom,
  type composeModules,
} from '@endora-commerce/platform/composition';
import { DISCOVERED_MANIFESTS } from '../../src/manifest-index.generated.js';

/**
 * The command-hook registry and its sealing data for a test root that composes the generated
 * module list — what `composeApp` builds for the two real roots (`specs/176-command-hooks-outbox/`
 * P2). A module of that list registers its own `afterCommit` handlers (`related_payers`,
 * `specs/182-related-payers/` research R-8), and `ctx.commandHooks` refuses a root that mounts no
 * registry; `test/contract/kernel/harness-parity.test.ts` names every root that forgets it.
 *
 * Pass both fields by name (`commandHookRegistry: hooks.registry, commandHooks: hooks.data`): the
 * parity test reads the option names a root writes, and a spread hides them.
 */
export function generatedListCommandHooks(): {
  readonly registry: CommandHookRegistry;
  readonly data: NonNullable<Parameters<typeof composeModules>[1]['commandHooks']>;
} {
  const manifests = DISCOVERED_MANIFESTS.map((entry) => entry.manifest);
  return {
    registry: new CommandHookRegistry(),
    data: {
      hookableActions: hookableActionsFrom(manifests),
      moduleDependencies: moduleDependencyClosureFrom(manifests),
      commandHookOrder: {},
    },
  };
}
