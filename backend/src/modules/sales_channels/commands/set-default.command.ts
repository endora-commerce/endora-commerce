import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@b2b/contracts';
import type { Command } from '../../../commands/command.js';
import { HttpError } from '../../../http/error-envelope.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';

/**
 * Moving the `system_default` flag — feature 072 / D-51, Principle XIII.
 *
 * The third property of the product owner's invariant: exactly one channel is
 * the default, and the flag is **movable**. The first two have been enforced
 * since feature 005 (a partial unique index, plus a boot reconciler and three
 * service refusals); this is the one nothing in the platform could do.
 *
 * It is a Command because it is the definition of a sensitive write: it changes
 * where every unattributed order, every platform-wide fallback read and every
 * orphan rebind lands, and the operator who did it has to be recoverable from
 * the audit trail. The audit row names both channels — `stateBefore` the one
 * that held the flag, `stateAfter` the one that holds it now — because "which
 * channel was the default in March" is the question this row exists to answer.
 *
 * **Not `reversible`.** The registry's `reversible` marks commands wired into
 * the operator-facing undo of feature 054 (a `RevertRecord` set on a bulk
 * operation row), and there is no such surface for a single channel flag. The
 * move is undone by making the same call against the previous default, whose
 * code the response and the audit row both carry — an inverse an operator can
 * perform, not a stored revert state.
 */

export interface SetSystemDefaultChannelResult {
  /** The channel that holds the flag once the command has run. */
  readonly channel: SalesChannel;
  /**
   * The code that held the flag when the command started — the channel a
   * subsequent `set-default` would move it back to. `null` only in the state the
   * boot reconciler exists to repair: a table with rows but no default at all.
   */
  readonly previousDefaultCode: string | null;
  /** False when the target already held the flag; the call wrote nothing. */
  readonly changed: boolean;
}

/**
 * Demote-then-promote, in this order, inside the Command Bus's transaction.
 *
 * `sales_channels_one_system_default` is a partial unique index and Postgres
 * cannot defer one, so the two updates are two statements with the demote
 * first — the flag has to be off the old row before it can land on the new one.
 * Assigning both and flushing once is **not** equivalent: MikroORM decides the
 * statement order for a change set, and the promote-first ordering trips the
 * index. That is also why a concurrent second move blocks on the index and then
 * fails closed rather than racing, which is the behaviour we want.
 *
 * Both guards live inside the transaction rather than in the caller: the
 * caller's lookup produces the 404 and a readable message, this one is what is
 * still true at the moment of the write.
 */
export function makeSetSystemDefaultChannelCommand(
  channelId: string,
): Command<SetSystemDefaultChannelResult> {
  return {
    action: 'sales_channel.set_default',
    objectType: 'sales_channel',
    objectId: channelId,
    run: async ({ em }) => {
      const target = await em.findOne(SalesChannel, { id: channelId });
      if (target === null) {
        throw new HttpError(
          404,
          ERROR_CODES.NOT_FOUND,
          'The sales channel to promote no longer exists.',
        );
      }

      const current = await em.findOne(SalesChannel, { systemDefault: true });

      // Already the default: a no-op success, not an error. A retried request and
      // a double-clicked button answer the same 200, and `skipAudit` keeps "no
      // write ⇒ no audit row" honest.
      if (target.systemDefault) {
        return {
          result: { channel: target, previousDefaultCode: target.code, changed: false },
          skipAudit: true,
        };
      }

      // A default nobody can transact on is not a default. The mirror of the
      // three refusals that keep the default channel from being deactivated or
      // deleted (`sales-channels.service.ts:231/272/317`): they stop the flag's
      // holder from going inactive, this stops an inactive channel from becoming
      // the holder.
      if (!target.active) {
        throw new HttpError(
          422,
          ERROR_CODES.INACTIVE_SALES_CHANNEL,
          `Sales channel "${target.code}" is inactive and cannot become the system default. ` +
            `Activate it first.`,
        );
      }

      const before =
        current === null ? null : { id: current.id, code: current.code };

      // 1. Demote, and get it into the database before step 2 exists.
      if (current !== null) {
        current.systemDefault = false;
        current.version += 1;
        await em.flush();
      }

      // 2. Promote.
      target.systemDefault = true;
      target.version += 1;
      await em.flush();

      return {
        result: {
          channel: target,
          previousDefaultCode: current?.code ?? null,
          changed: true,
        },
        before,
        after: { id: target.id, code: target.code },
      };
    },
    event: (result) =>
      result.changed
        ? {
            eventName: 'sales_channels.lifecycle_changed',
            payload: {
              eventId: randomUUID(),
              occurredAt: new Date().toISOString(),
              channelCode: result.channel.code,
              // Two rows changed identity-bearing state, and the cache is keyed
              // by code with `systemDefault` inside the cached value — so the
              // demoted channel's entry is stale too. Same shape the delete path
              // uses for the same reason.
              invalidateAll: true,
            },
          }
        : undefined,
  };
}
