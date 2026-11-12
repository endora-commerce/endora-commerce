import { ORGANIZATION_HOOKABLE_ACTIONS } from '@endora-commerce/contracts';
import { CommandHookRefusal, type Command, type CommandHookContext } from '@endora-commerce/platform/commands';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import {
  COMMAND_HOOK_FIXTURE_MARKER,
  COMMAND_HOOK_FIXTURE_VETO,
  commandHookFixtureErrorCodes,
} from './manifest.js';

/**
 * The command-hook fixture's composition (`specs/176-command-hooks-outbox/` T029).
 *
 * Two `beforeCommit` hooks, one on `organization.create` and one on
 * `organization.register`, both written against the refs `organizations`
 * publishes in `@endora-commerce/contracts`, so `data` is typed by the owner's
 * declaration and nothing of `organizations` is imported.
 *
 * On a marked Organization each hook does what a real instance hook does:
 *
 *  - it runs a Command of its **own** through `ctx.run` — `command_hook_fixture.observe`,
 *    whose audit entry is the fixture's "row": written on the owner's
 *    transaction, so it commits with the Organization or not at all;
 *  - it names what it wrote with `noteAuditChanges`, which lands in the owner's
 *    one entry as `extensions.command_hook_fixture.changedFields`;
 *  - and, when the name also carries the veto word, it refuses with its own
 *    declared code — the whole Command rolls back and the caller gets
 *    `409 COMMAND_HOOK_FIXTURE_REFUSED` in their language.
 *
 * An unmarked name passes through untouched.
 */

interface ObservedOrganization {
  readonly organization: { readonly id: string; readonly name: string };
}

/** The fixture's own audited write: one entry, codes only (`audit-state.md` list 1). */
function observeCommand(organizationId: string, hookId: string): Command<null> {
  return {
    action: 'command_hook_fixture.observe',
    objectType: 'organization',
    objectId: organizationId,
    async run() {
      return { result: null, before: null, after: { hookId } };
    },
  };
}

function observe(hookId: string) {
  return async (ctx: CommandHookContext<ObservedOrganization>): Promise<void> => {
    const { organization } = ctx.data;
    if (!organization.name.startsWith(COMMAND_HOOK_FIXTURE_MARKER)) return;
    await ctx.run(observeCommand(organization.id, hookId));
    ctx.noteAuditChanges(['x_command_hook_fixture_observed']);
    if (organization.name.includes(COMMAND_HOOK_FIXTURE_VETO)) {
      throw new CommandHookRefusal(
        409,
        commandHookFixtureErrorCodes.COMMAND_HOOK_FIXTURE_REFUSED,
        'The command hook fixture refused this Organization.',
      );
    }
  };
}

export function registerModule(ctx: ModuleContext): void {
  ctx.commandHooks([
    {
      id: 'observe-create',
      on: ORGANIZATION_HOOKABLE_ACTIONS.create,
      phase: 'beforeCommit',
      handler: observe('observe-create'),
    },
    {
      id: 'observe-register',
      on: ORGANIZATION_HOOKABLE_ACTIONS.register,
      phase: 'beforeCommit',
      handler: observe('observe-register'),
    },
  ]);
}
