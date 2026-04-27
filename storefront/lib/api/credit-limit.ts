import { apiGetAuthed } from './mutations';
import { StorefrontApiError } from './client';

/**
 * Credit limit binding (T219). The endpoint returns 404
 * CREDIT_LIMIT_NOT_GRANTED when the buyer's organization has not been
 * granted a limit; the storefront treats that as "feature off" rather
 * than an error and renders the credit-limit widgets conditionally.
 */

export interface CreditLimitReservationView {
  orderId: string;
  amount: number;
  createdAt: string;
}

export interface CreditLimitView {
  organizationId: string;
  grantedAmount: number;
  availableAmount: number;
  currency: string;
  activeReservations: CreditLimitReservationView[];
  grantedAt: string;
}

export async function getMyCreditLimit(sessionCookie: string): Promise<CreditLimitView | null> {
  try {
    return await apiGetAuthed<CreditLimitView>({
      path: '/api/v1/me/credit-limit',
      sessionCookie,
    });
  } catch (err) {
    if (
      err instanceof StorefrontApiError &&
      err.status === 404 &&
      err.code === 'CREDIT_LIMIT_NOT_GRANTED'
    ) {
      return null;
    }
    throw err;
  }
}
