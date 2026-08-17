import type { EmailMailerSendInput } from '@b2b/contracts';

/**
 * Feature 038 (US5) — email sent to the customer when a sales rep / admin adds
 * a customer-visible comment with "notify" enabled. Idempotent on messageId
 * (one per comment body hash + order) so retries don't double-send.
 */
export function buildOrderCommentNotificationEmail(params: {
  to: string;
  orderId: string;
  businessId: string;
  body: string;
}): EmailMailerSendInput {
  return {
    messageId: `order_comment:${params.orderId}:${hash(params.body)}`,
    to: params.to,
    subject: `New comment on your order ${params.businessId}`,
    text: [
      `A new comment was added to your order ${params.businessId}:`,
      '',
      params.body,
    ].join('\n'),
    meta: { orderId: params.orderId, kind: 'order_comment' },
  };
}

/** Small stable hash for the idempotency key (not security-sensitive). */
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
