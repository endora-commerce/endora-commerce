import type {
  CustomerAccountReadPort,
  OrderReadPort,
  OrganizationDetailsPort,
  OrganizationPermissionPort,
  TransactionalEmailSender,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import type {
  RELATED_PAYER_ORDER_CANCELLED_EMAIL_CODE,
  RELATED_PAYER_ORDER_PLACED_EMAIL_CODE,
} from '../email-templates/payer-order-defaults.js';

/** The payer's two e-mails (RP-17 b) — no other order event is announced to the payer. */
export type PayerOrderEmailCode =
  | typeof RELATED_PAYER_ORDER_PLACED_EMAIL_CODE
  | typeof RELATED_PAYER_ORDER_CANCELLED_EMAIL_CODE;

/** The permission whose holders hear of an order billed to their Organization (FR-074). */
const VIEW_PAID_ORDERS = 'related_payers.view_paid_orders';

export interface PayerOrderEmailDeps {
  /** `transactional_emails`' late-bound sender; `undefined` until announced. */
  readonly sender: () => TransactionalEmailSender | undefined;
  readonly orders: Pick<OrderReadPort, 'findById'>;
  /** Whether the buyer's link to this payer asks for the payer to be told (A-4). */
  readonly notifiesPayer: (buyerOrganizationId: string, payerOrganizationId: string) => Promise<boolean>;
  readonly customerAccounts: Pick<CustomerAccountReadPort, 'listByOrganization'>;
  readonly organizations: Pick<OrganizationDetailsPort, 'findById'>;
  readonly permissions: Pick<OrganizationPermissionPort, 'rolesHolding'>;
  /** The default language of a store, `null` when it does not resolve. */
  readonly channelLanguage: (salesChannelId: string) => Promise<string | null>;
  readonly log: (message: string, context: Record<string, unknown>) => void;
}

/**
 * `specs/182-related-payers/` FR-074, RP-17 (b, d) — on an order billed to a payer whose link
 * has `notify_payer_on_orders` on, placed or cancelled, one `code` e-mail per active member of
 * the payer whose role holds *View orders we pay for*, in the store's default language.
 *
 * Fire-and-forget and audible, as the cart-approval e-mails: the order stands whatever
 * happens here, so a message that does not go out is logged and never raised.
 */
export async function sendPayerOrderEmails(
  deps: PayerOrderEmailDeps,
  orderId: string,
  code: PayerOrderEmailCode,
): Promise<void> {
  const order = await deps.orders.findById(orderId);
  const payerId = order?.payerOrganizationId ?? null;
  if (!order || !payerId) return;
  if (!(await deps.notifiesPayer(order.organizationId, payerId))) return;

  const [members, roles, buyer, payer, channelLanguage] = await Promise.all([
    deps.customerAccounts.listByOrganization(payerId, { activeOnly: true }),
    deps.permissions.rolesHolding(payerId, VIEW_PAID_ORDERS),
    deps.organizations.findById(order.organizationId),
    deps.organizations.findById(payerId),
    deps.channelLanguage(order.salesChannelId),
  ]);
  const recipients = members.filter(
    (m) => roles.includes(m.organizationRoleId) && m.blockedAt === null && m.anonymizedAt === null && m.email !== '',
  );
  const context = { orderId, code };
  if (recipients.length === 0) return deps.log('[related_payers] the payer order e-mail was not sent', { ...context, reason: 'no_recipient' });
  const language = channelLanguage ?? 'en-US';
  const variables = {
    buyer: { name: buyer?.name ?? '' },
    payer: { name: payer?.name ?? '' },
    order: { number: order.businessId, total: `${order.total} ${order.currency}` },
  };

  for (const recipient of recipients) {
    const sender = deps.sender();
    if (!sender) return deps.log('[related_payers] the payer order e-mail was not sent', { ...context, reason: 'no_sender' });
    try {
      const outcome = await sender.send({
        code,
        salesChannelId: order.salesChannelId,
        language,
        to: recipient.email,
        messageId: `${code}:${orderId}:${recipient.id}`,
        variables,
        meta: { kind: code, orderId },
      });
      if (outcome.status !== 'sent') {
        deps.log('[related_payers] the payer order e-mail was not sent', { ...context, recipientId: recipient.id, reason: outcome.status });
      }
    } catch (error) {
      deps.log('[related_payers] the payer order e-mail was not sent', {
        ...context,
        recipientId: recipient.id,
        reason: error instanceof ModuleDisabledError ? 'module_disabled' : 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
