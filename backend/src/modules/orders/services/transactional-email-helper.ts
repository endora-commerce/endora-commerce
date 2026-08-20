// Feature 047 — small helper to send an order-scoped transactional email via the
// admin-editable template, resolving the sales-channel default language.

import type { EntityManager } from '@mikro-orm/postgresql';
import type { TransactionalEmailSender } from '@b2b/contracts';
import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';
import type { Order } from '../entities/order.entity.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';

/**
 * Why an order-scoped e-mail did — or did not — go out (issue #78).
 *
 * This helper answered `void`, and every order surface sending through it read
 * that `void` as "handled — do not use the legacy in-code builder". Since issue
 * #67 the sender distinguishes a delivered message from a deactivated template,
 * a transport-less composition and a code with no definition; all three arrived
 * here and were dropped, so four customer-facing notifications could silently
 * not happen while the operation that triggered them reported success.
 */
export type OrderEmailNotSentReason =
  /** No address resolves for this order's customer. */
  | 'no_recipient'
  /** No mailer is wired at all — neither the template path nor the legacy one. */
  | 'no_transport'
  /** The operator switched this e-mail off. */
  | 'deactivated'
  /** No template exists for this code yet. */
  | 'no_definition'
  /**
   * The transport itself declined to send (D-59). Today the one reason is an
   * already-accepted `messageId`, so this call delivered nothing and an earlier
   * one delivered the message — which is why it is not `failed`.
   */
  | 'suppressed'
  /** The send raised, and the order operation stays committed. */
  | 'failed';

export type OrderEmailResult = { sent: true } | { sent: false; reason: OrderEmailNotSentReason };

/**
 * Where a send that did not happen is reported. Injectable so a test can read
 * it; defaults to `console.warn`, which is what the rest of this layer uses.
 */
export type OrderEmailLog = (message: string, context: Record<string, unknown>) => void;

/** Which order and which e-mail a not-sent line is about. */
export interface OrderEmailContext {
  orderId: string;
  code: string;
}

/**
 * Name a send that did not happen, and write it where an operator can find it.
 *
 * Exported because the callers own two of the reasons before this helper is
 * ever reached — no recipient on the order, and no transport in the
 * composition — and those used to be bare `return`s indistinguishable from a
 * delivered message.
 */
export function orderEmailNotSent(
  log: OrderEmailLog | undefined,
  context: OrderEmailContext,
  reason: OrderEmailNotSentReason,
  error?: unknown,
): OrderEmailResult {
  (log ?? defaultOrderEmailLog)('[orders] the order e-mail was not sent', {
    ...context,
    reason,
    ...(error === undefined ? {} : { error: error instanceof Error ? error.message : error }),
  });
  return { sent: false, reason };
}

const defaultOrderEmailLog: OrderEmailLog = (message, context): void => {
  console.warn(message, context);
};

/**
 * Sends one order-scoped transactional e-mail and reports what happened.
 *
 * **Best-effort, and now audible.** Every caller runs this after its own write
 * has committed, so a send that fails must not undo it — but it is named in the
 * result and written to the log rather than returning the same nothing a
 * delivered message returns.
 */
export async function sendOrderTransactionalEmail(
  em: EntityManager,
  sender: TransactionalEmailSender,
  order: Pick<Order, 'salesChannelId'>,
  input: {
    orderId: string;
    code: string;
    to: string;
    messageId: string;
    variables: Record<string, unknown>;
    meta?: Record<string, unknown>;
    /**
     * The language to render in, when the caller has already resolved it.
     * Absent, the order's channel default is read here.
     */
    language?: string;
  },
  log?: OrderEmailLog,
): Promise<OrderEmailResult> {
  const context: OrderEmailContext = { orderId: input.orderId, code: input.code };
  try {
    const language =
      input.language ??
      (await em.findOne(SalesChannel, { id: order.salesChannelId }))?.defaultLanguage ??
      'en-US';
    const outcome = await sender.send({
      code: input.code,
      salesChannelId: order.salesChannelId,
      language,
      to: input.to,
      messageId: input.messageId,
      variables: input.variables,
      ...(input.meta ? { meta: input.meta } : {}),
    });
    if (outcome.status !== 'sent') return orderEmailNotSent(log, context, outcome.status);
    return { sent: true };
  } catch (error) {
    // A switched-off module is a presence answer about the whole operation, not
    // a message that failed to render; absorbing it would report "sent nothing"
    // where the truthful answer is "this capability is off".
    rethrowIfModuleDisabled(error);
    // Everything else is contained: the order write has committed and must not
    // be undone because the message did not go out. It is named, though.
    return orderEmailNotSent(log, context, 'failed', error);
  }
}
