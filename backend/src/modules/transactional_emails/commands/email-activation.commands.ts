import { ERROR_CODES } from '@endora-commerce/contracts';
import type { Command } from '../../../commands/command.js';
import { HttpError } from '../../../http/error-envelope.js';
import { TransactionalEmail } from '../entities/transactional-email.entity.js';
import type { EmailDefaultsRegistry } from '../services/email-defaults-registry.js';

/**
 * The per-email operator flip — issue #89, Principle XIII.
 *
 * `TransactionalEmail.active` has been honoured on the send path since feature
 * 047 (`transactional-email.service.ts`), but nothing could write it: the only
 * way to silence one email was to edit the row by hand. This is that door, and
 * it is deliberately built like the module-level one in
 * `_lifecycle/commands/activation.commands.ts` — refuse in the factory before a
 * transaction opens, then one Command, one audit row, one transaction.
 *
 * Reading the two together is the point. An operator meets the same 409 and the
 * same carried reason whether they aim at a module or at a single email, and a
 * reviewer comparing the files sees one pattern rather than two conventions.
 */

export interface SetTransactionalEmailActiveInput {
  code: string;
  active: boolean;
}

/**
 * Refuse a flip the owning module forbids.
 *
 * Refused in **both** directions, exactly as the module door refuses a
 * non-deactivatable module in both. A protected email is always on, so
 * `active: true` is not a repair — it is a request to operate a switch that
 * does not exist, and answering 200 to it would teach an operator that the
 * control is real.
 */
export function assertEmailActivationWritable(
  code: string,
  defaults: EmailDefaultsRegistry,
): void {
  const reason = defaults.nonDeactivatableReasonOf(code);
  if (reason === null) return;
  throw new HttpError(409, ERROR_CODES.TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE, reason, {
    code,
    reason,
  });
}

/**
 * Flip one email's activation.
 *
 * Reversible in the registry sense: the row keeps its content, its overrides
 * and its per-channel customizations, so the undo is switching it back on —
 * the same property Constitution XVII asserts for a module.
 */
export function makeSetTransactionalEmailActiveCommand(
  input: SetTransactionalEmailActiveInput,
  defaults: EmailDefaultsRegistry,
): Command<{ code: string; active: boolean }> {
  assertEmailActivationWritable(input.code, defaults);

  return {
    action: 'transactional_email.activation.set',
    objectType: 'transactional_email',
    objectId: input.code,
    run: async ({ em }) => {
      const email = await em.findOne(TransactionalEmail, { code: input.code });
      if (!email) {
        throw new HttpError(
          404,
          ERROR_CODES.NOT_FOUND,
          `Transactional email "${input.code}" not found.`,
        );
      }
      const before = email.active;
      email.active = input.active;
      await em.flush();

      return {
        result: { code: input.code, active: input.active },
        before: { code: input.code, active: before },
        after: { code: input.code, active: input.active },
      };
    },
  };
}
