import { ORGANIZATION_HOOKABLE_ACTIONS } from '@endora-commerce/contracts';
import {
  CommandHookRefusal,
  type AfterCommitContext,
  type Command,
  type CommandBus,
  type CommandHookContext,
} from '@endora-commerce/platform/commands';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
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
 *
 * Two `afterCommit` handlers (`specs/176-command-hooks-outbox/` P3, T044),
 * one per action, show the outbox end to end, and they too act only on a
 * marked Organization. The outbox row carries ids and codes only, so a handler
 * cannot read the marker; the `beforeCommit` hook, which can, remembers the
 * marked Organization's id in this composition's memory, and the handler acts
 * on a row only when its Organization is remembered. Every other row is
 * delivered as a no-op — as is every row delivered by a process other than the
 * one that took the write, which is how a split `api` / `worker` deployment
 * would run it, and is why this stays a fixture's trick. Acting, a handler
 * records what it was handed by running a Command of its own,
 * `command_hook_fixture.deliver`, whose audit entry is the evidence: the
 * context it ran in, the causation it was given, and — on the entry's own
 * columns — the request id the drain restored.
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

function observe(hookId: string, marked: Set<string>) {
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
    // After the veto: a refused Organization is never written, so there is no
    // row to deliver and nothing to remember.
    marked.add(organization.id);
  };
}

/** What a delivery saw, as names, codes, booleans and ids only (`audit-state.md` list 1). */
function deliverCommand(ctx: AfterCommitContext<{ readonly organizationId: string }>, hookId: string): Command<null> {
  const tenant = getTenantContext();
  return {
    action: 'command_hook_fixture.deliver',
    objectType: 'organization',
    objectId: ctx.objectId,
    async run() {
      return {
        result: null,
        before: null,
        after: {
          hookId,
          attempt: ctx.attempt,
          tenantMode: tenant?.mode ?? null,
          pinnedToRowOrganization: tenant?.mode === 'single-org' && tenant.organizationId === ctx.organizationId,
          causationActorKind: ctx.causation.actor.kind,
          causationAdminUserId: ctx.causation.actor.actorAdminUserId,
          causationHasRequestId: (ctx.causation.requestId ?? null) !== null,
        },
      };
    },
  };
}

export function registerModule(ctx: ModuleContext): void {
  // The marked Organizations this composition's hooks saw — see the header.
  const marked = new Set<string>();
  const deliver =
    (hookId: string) =>
    async (delivery: AfterCommitContext<{ readonly organizationId: string }>): Promise<void> => {
      if (!marked.has(delivery.objectId)) return;
      await ctx.cradle<{ commandBus: CommandBus }>().commandBus.run(deliverCommand(delivery, hookId));
      marked.delete(delivery.objectId);
    };
  ctx.commandHooks([
    {
      id: 'observe-create',
      on: ORGANIZATION_HOOKABLE_ACTIONS.create,
      phase: 'beforeCommit',
      handler: observe('observe-create', marked),
    },
    {
      id: 'observe-register',
      on: ORGANIZATION_HOOKABLE_ACTIONS.register,
      phase: 'beforeCommit',
      handler: observe('observe-register', marked),
    },
    {
      id: 'deliver-create',
      on: ORGANIZATION_HOOKABLE_ACTIONS.create,
      phase: 'afterCommit',
      handler: deliver('deliver-create'),
    },
    {
      id: 'deliver-register',
      on: ORGANIZATION_HOOKABLE_ACTIONS.register,
      phase: 'afterCommit',
      handler: deliver('deliver-register'),
    },
  ]);
}
