import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import { withSystemScope } from '../../../tenancy/escape-hatch.js';
import { Invoice } from '../entities/invoice.entity.js';
import { channelName } from './numbering-configuration.js';

/**
 * The unique index that makes an invoice number mean one document
 * platform-wide (`20260425T050720_core_commerce_init.ts`).
 */
const NUMBER_UNIQUE_CONSTRAINT = 'invoices_number_unique';

/**
 * Turn a duplicated invoice number into the operator's account of it —
 * feature 078, D-95.2.
 *
 * This is the layer that carries the **guarantee**. The channel-distinct
 * default stops the ordinary path from arming a duplicate and the settings
 * refusal stops a misconfiguration from being saved, but issuance is the one
 * chokepoint every number passes through, so it is what makes platform-wide
 * uniqueness hold. It refuses only an **actual** collision — a row the database
 * has already rejected — never a possible one: a pre-flight "could this
 * collide" at issuance would block sales that would have succeeded and would
 * cost a settings read per channel on the hot path to do it.
 *
 * The transaction has already rolled back by the time this runs, so the counter
 * draw is undone and a refused issuance leaves no gap in the sequence.
 *
 * Returns normally when `error` is a different failure; the caller re-throws it
 * unchanged. `invoices_order_kind_uq` in particular is a different fact with a
 * different answer and must keep surfacing as it does today.
 */
export async function refuseDuplicateInvoiceNumber(input: {
  readonly error: unknown;
  /**
   * The number drawn inside the transaction. It has to be captured into the
   * enclosing scope by the caller: the callback's result is lost when the
   * transaction aborts, and this refusal exists to name the number.
   */
  readonly drawnNumber: string | null;
  readonly salesChannelId: string | null;
  readonly emFactory: () => EntityManager;
}): Promise<void> {
  if (!(input.error instanceof UniqueConstraintViolationException)) return;
  if (violatedConstraint(input.error) !== NUMBER_UNIQUE_CONSTRAINT) return;
  const number = input.drawnNumber;
  if (number === null) return;

  // The invoice already holding the number is very often another
  // organization's, and `Invoice` is `@TransitivelyScoped(() => Order,
  // 'orderId')`, so the read crosses organizations deliberately. It exposes
  // **only** the number and the channel — never the buyer, the order or the
  // amount.
  const holder = await withSystemScope(
    'invoices: name the channel already holding a duplicated invoice number',
    async () => {
      const em = input.emFactory();
      const existing = await em.findOne(Invoice, { number });
      if (!existing) return null;
      const channel = existing.salesChannelId
        ? await em.findOne(SalesChannel, { id: existing.salesChannelId })
        : null;
      return { salesChannelId: existing.salesChannelId ?? null, channel };
    },
  );

  // The holder was deleted between the violation and this read. Fall back to
  // the tokenless base sentence rather than fabricating a channel.
  if (!holder || !holder.channel) {
    throw new HttpError(
      409,
      ERROR_CODES.INVOICE_NUMBER_ALREADY_ISSUED,
      `Invoice number "${number}" is already in use. Nothing was issued.`,
      { number },
    );
  }

  const sameChannel = holder.salesChannelId === input.salesChannelId;
  throw new HttpError(
    409,
    ERROR_CODES.INVOICE_NUMBER_ALREADY_ISSUED,
    sameChannel
      ? `Invoice number "${number}" has already been issued in this sales channel. ` +
        `Nothing was issued.`
      : `Invoice number "${number}" is already used by sales channel ` +
        `"${channelName(holder.channel)}". Nothing was issued.`,
    {
      code: sameChannel ? 'same_channel' : 'other_channel',
      number,
      channel: channelName(holder.channel),
      channelCode: holder.channel.code,
    },
  );
}

/**
 * The constraint the database named, dug out of the driver error.
 *
 * MikroORM wraps the `pg` error, and the constraint name is what tells
 * `invoices_number_unique` apart from `invoices_order_kind_uq` — two different
 * facts with two different answers, so guessing from the exception class alone
 * would make the wrong one wear this refusal.
 */
function violatedConstraint(error: unknown): string | null {
  let cursor: unknown = error;
  for (let depth = 0; cursor !== null && cursor !== undefined && depth < 5; depth += 1) {
    const named = (cursor as { constraint?: unknown }).constraint;
    if (typeof named === 'string') return named;
    const wrapped = cursor as { previous?: unknown; cause?: unknown };
    cursor = wrapped.previous ?? wrapped.cause;
  }
  return null;
}
