import type { EmailMailerPort } from '@endora-commerce/contracts';
import type { InventoryTemplateEmailPort } from './low-stock-alert-service.js';

/** The transactional e-mail both back-in-stock senders render (manifest `transactionalEmails`). */
export const BACK_IN_STOCK_EMAIL_CODE = 'availability_back_in_stock';

export interface BackInStockMessage {
  /** The subscription id — the message id is derived from it, so a re-run is suppressed. */
  notificationId: string;
  to: string;
  /** The product name at the subscription's scope (`backInStockNames`, issue #696). */
  productName: string;
  /** The subscription's channel; `null` on a row written before #696, or whose channel is gone. */
  salesChannelId: string | null;
  /** The subscription's scope language; `null` = the channel's default language. */
  languageCode: string | null;
  meta: Record<string, unknown>;
}

/**
 * Sends one back-in-stock e-mail — the one path both senders share (issue #1256).
 *
 * The message is the operator-editable `availability_back_in_stock` template, rendered in the
 * subscription's channel and language. `templateEmailPort` resolves what is missing: no channel
 * (or one since deleted) renders on the system-default channel, no language in the channel's
 * default language (`TemplateEmailPort`'s doc block).
 *
 * The fixed English plain text is reached only when the template path answers `false`: no
 * template sender wired, or no definition for the code. An operator who switched the e-mail off
 * gets `true` and nothing is sent — falling back would send the mail they turned off.
 */
export async function sendBackInStockEmail(
  channels: { templateEmail?: InventoryTemplateEmailPort | undefined; mailer?: EmailMailerPort | undefined },
  message: BackInStockMessage,
): Promise<void> {
  const messageId = `availability:${message.notificationId}`;
  if (channels.templateEmail) {
    const handled = await channels.templateEmail.trySend({
      code: BACK_IN_STOCK_EMAIL_CODE,
      to: message.to,
      messageId,
      variables: { product: { name: message.productName } },
      meta: message.meta,
      salesChannelId: message.salesChannelId,
      language: message.salesChannelId ? message.languageCode : null,
    });
    if (handled) return;
  }
  if (!channels.mailer) return;
  const outcome = await channels.mailer.send({
    messageId,
    to: message.to,
    subject: `Back in stock: ${message.productName}`,
    text: `Good news — "${message.productName}" is available again.`,
    kind: BACK_IN_STOCK_EMAIL_CODE,
    meta: message.meta,
  });
  // Only the transport's refusal is named here. `logged` (issue #186) is the console driver
  // saying no mail server is configured: it has already written the message to the log itself,
  // and the delivery record says so.
  if (outcome.status === 'suppressed') {
    // The subscription is still consumed: the one suppression a transport performs is an
    // already-accepted `messageId`, which means this subscriber was notified by an earlier run.
    console.warn('[inventory] the back-in-stock e-mail was not sent', {
      notificationId: message.notificationId,
      reason: outcome.reason,
    });
  }
}
