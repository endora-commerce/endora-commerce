import { ERROR_CODES, type OrganizationRestrictionPort } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * The chosen delivery and payment method must be on the allow-lists of the
 * Organization the order is placed for.
 *
 * An operator can restrict an Organization to a subset of the delivery and
 * payment methods, and the storefront catalogues list only that subset to its
 * buyers. Placement is handed method **ids**, so the listing alone refuses
 * nothing; this is the refusal behind it.
 *
 * ## The rule, mirrored from the listings
 *
 * `GET /api/v1/payment-methods` and `GET /api/v1/delivery-methods` filter only
 * when the list is present **and** non-empty. So do these: `null` (the owner's
 * answer for an Organization it does not know) and `[]` (an Organization with
 * no link rows, the ordinary case) both mean "no restriction", and each kind is
 * judged on its own list.
 *
 * ## Which Organization
 *
 * The one the caller resolved the order's `CustomerContext` from — the session,
 * the API key's binding, or the customer an operator creates the order for.
 * Never an id read from a request body.
 *
 * ## Operators are bound
 *
 * An order an administrator creates on a customer's behalf honours that
 * customer's Organization allow-lists (owner decision). There is no exemption,
 * no option that skips this gate and no setting that turns it off.
 *
 * ## Failure
 *
 * No `catch` around the port. `allowedIdsFor` already answers the one degrade
 * it means to (`null`); anything it throws — `organizations` switched off, a
 * failing read — refuses the placement rather than reading as "unrestricted".
 */
export const DELIVERY_METHOD_NOT_ALLOWED_FOR_ORGANIZATION =
  'delivery_method_not_allowed_for_organization';
export const PAYMENT_METHOD_NOT_ALLOWED_FOR_ORGANIZATION =
  'payment_method_not_allowed_for_organization';

export interface OrganizationMethodChoice {
  readonly organizationId: string;
  readonly deliveryMethodId?: string | null | undefined;
  readonly paymentMethodId?: string | null | undefined;
}

function excludes(allowed: string[] | null, id: string): boolean {
  return allowed !== null && allowed.length > 0 && !allowed.includes(id);
}

export async function assertMethodsAllowedForOrganization(
  restriction: OrganizationRestrictionPort,
  choice: OrganizationMethodChoice,
): Promise<void> {
  const { organizationId, deliveryMethodId, paymentMethodId } = choice;

  if (deliveryMethodId) {
    const allowed = await restriction.allowedIdsFor(organizationId, 'deliveryMethodIds');
    if (excludes(allowed, deliveryMethodId)) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'The selected delivery method is not available to this Organization.',
        { code: DELIVERY_METHOD_NOT_ALLOWED_FOR_ORGANIZATION, deliveryMethodId },
      );
    }
  }

  if (paymentMethodId) {
    const allowed = await restriction.allowedIdsFor(organizationId, 'paymentMethodIds');
    if (excludes(allowed, paymentMethodId)) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'The selected payment method is not available to this Organization.',
        { code: PAYMENT_METHOD_NOT_ALLOWED_FOR_ORGANIZATION, paymentMethodId },
      );
    }
  }
}
