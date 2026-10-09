import {
  ERROR_CODES,
  type DeliveryMethodReadPort,
  type PaymentMethodReadPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * The chosen delivery and payment method must be offered in the sales channel
 * the order is placed on.
 *
 * ## What it closes
 *
 * An operator restricts a method to some sales channels, and the storefront
 * catalogues (`GET /api/v1/delivery-methods`, `GET /api/v1/payment-methods`)
 * list only the methods offered in the request's channel. A listing is not an
 * authorisation, though: placement is handed a method **id**, and until this
 * gate it accepted any active one — so a client that kept an id from another
 * channel, or simply typed one, could ship or pay with a method its channel
 * does not offer. The catalogue hides; this refuses.
 *
 * ## Which channel
 *
 * The channel **the order records** — `placeOrder` resolves it once and stamps
 * it, and that is the one handed in here. It is the same channel on every
 * surface that places an order, which is what makes one gate enough: the
 * storefront's resolved request channel, the channel an administrator chose
 * for an order created on a customer's behalf, and the channel an API key is
 * bound to.
 *
 * ## Who decides "offered"
 *
 * The method's own module, through `isAvailableInChannel` on its read port —
 * `orders` never looks at a membership table and never restates the rule (a
 * method bound to no channel is offered in every one). An **absent** owner is
 * not this gate's refusal to make: the caller has already resolved the method
 * through the same port, and an absent port refused the placement there.
 *
 * `400 VALIDATION_FAILED` with the sentence the adapter re-validation beside it
 * already answers for a method that is not usable for this order, plus a
 * `details.code` so a client can tell the reasons apart.
 */
export interface MethodChannelReads {
  readonly deliveryMethodRead: () => Pick<DeliveryMethodReadPort, 'isAvailableInChannel'> | null;
  readonly paymentMethodRead: () => Pick<PaymentMethodReadPort, 'isAvailableInChannel'> | null;
}

export async function assertMethodsOfferedInChannel(
  reads: MethodChannelReads,
  input: {
    readonly salesChannelId: string;
    readonly deliveryMethodId?: string | null | undefined;
    readonly paymentMethodId?: string | null | undefined;
  },
): Promise<void> {
  const { salesChannelId, deliveryMethodId, paymentMethodId } = input;

  if (deliveryMethodId) {
    const offered = await reads
      .deliveryMethodRead()
      ?.isAvailableInChannel(deliveryMethodId, salesChannelId);
    if (offered === false) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'The selected shipping method is not available for this order.',
        { code: 'delivery_method_not_in_sales_channel', deliveryMethodId, salesChannelId },
      );
    }
  }

  if (paymentMethodId) {
    const offered = await reads
      .paymentMethodRead()
      ?.isAvailableInChannel(paymentMethodId, salesChannelId);
    if (offered === false) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'The selected payment method is not available for this order.',
        { code: 'payment_method_not_in_sales_channel', paymentMethodId, salesChannelId },
      );
    }
  }
}
