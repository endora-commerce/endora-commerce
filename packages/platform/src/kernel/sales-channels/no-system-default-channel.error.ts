import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';

/**
 * The platform has no sales channel holding `system_default` (feature 072,
 * D-47 / D-48).
 *
 * This is a **platform fault, not a caller error**, and it is unreachable on a
 * booted deployment: the boot reconciler
 * (`kernel/sales-channels/default-channel-reconciler.ts`) inserts or promotes a
 * default on every serving path, a partial unique index forbids a second one,
 * and `SalesChannelsService` refuses every delete, deactivate and `active:false`
 * that would take the flag away. The only way to observe it is to read a
 * channel before composition has run the reconciler.
 *
 * It exists so that state has **one** spelling. Before D-48 it had four — a
 * `'default'` channel code where an id was wanted, a nil UUID, a `randomUUID()`
 * persisted into an order, and a silent switch to the platform-wide settings
 * tier — because `getSystemDefault()` returned `null` and every author had to
 * invent a value for a branch that cannot be taken.
 *
 * 500 `INTERNAL` is deliberate and matches what the resolver middleware already
 * answered on this condition: no request can be blamed for it and no client can
 * retry into a fix. The one surface that *renders* the condition rather than
 * failing on it is `/sales-channels` (D-51); every consumer propagates.
 */
export class NoSystemDefaultChannel extends HttpError {
  constructor() {
    super(
      500,
      ERROR_CODES.INTERNAL,
      'No sales channel holds the system-default flag; the boot-time default-channel ' +
        'reconciler has not run or could not repair the registry.',
    );
    this.name = 'NoSystemDefaultChannel';
  }
}
