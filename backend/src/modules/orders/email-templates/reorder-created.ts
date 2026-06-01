import type { MailerSendInput } from '../../email/services/mailer.js';

/**
 * Feature 038 (US6) — email to the customer when a sales rep / admin reorders
 * on their behalf: a cart of the previous order's items awaits checkout/payment.
 */
export function buildReorderCreatedEmail(params: {
  to: string;
  sourceBusinessId: string;
  orderId: string;
}): MailerSendInput {
  return {
    messageId: `order_reorder:${params.orderId}`,
    to: params.to,
    subject: `A new order is waiting for you (reorder of ${params.sourceBusinessId})`,
    text: [
      `We've prepared a new order on your account based on your previous order ${params.sourceBusinessId}.`,
      'Open your orders list to review and pay for it at checkout.',
    ].join('\n'),
    meta: { sourceOrderId: params.orderId, kind: 'order_reorder' },
  };
}
