import type { EmailMailerSendInput } from '@endora-commerce/contracts';

/**
 * Feature 038 (US3) — email to the customer when a sales rep / admin created
 * an order for them (e.g. built together on a call, or a preferential order).
 * The customer can open it from their orders list and pay it at checkout.
 */
export function buildAdminCreatedOrderEmail(params: {
  to: string;
  businessId: string;
  orderId: string;
}): EmailMailerSendInput {
  return {
    messageId: `order_created_for_you:${params.orderId}`,
    to: params.to,
    subject: `An order was created for you — ${params.businessId}`,
    text: [
      `Our team has prepared order ${params.businessId} on your account.`,
      'Open your orders list to review and pay for it at checkout.',
    ].join('\n'),
    meta: { orderId: params.orderId, kind: 'order_created_for_you' },
  };
}
