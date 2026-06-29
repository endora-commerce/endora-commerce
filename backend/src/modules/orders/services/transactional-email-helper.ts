// Feature 047 — small helper to send an order-scoped transactional email via the
// admin-editable template, resolving the sales-channel default language.

import type { EntityManager } from '@mikro-orm/postgresql';
import type { TransactionalEmailSender } from '@b2b/contracts';
import type { Order } from '../entities/order.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';

export async function sendOrderTransactionalEmail(
  em: EntityManager,
  sender: TransactionalEmailSender,
  order: Pick<Order, 'salesChannelId'>,
  input: {
    code: string;
    to: string;
    messageId: string;
    variables: Record<string, unknown>;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  const channel = await em.findOne(SalesChannel, { id: order.salesChannelId });
  await sender.send({
    code: input.code,
    salesChannelId: order.salesChannelId,
    language: channel?.defaultLanguage ?? 'en-US',
    to: input.to,
    messageId: input.messageId,
    variables: input.variables,
    ...(input.meta ? { meta: input.meta } : {}),
  });
}
