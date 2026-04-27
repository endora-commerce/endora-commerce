/**
 * Bank-transfer driver (T139 — already implicitly exercised by order-service).
 *
 * The driver is intentionally pure metadata: bank-transfer orders carry
 * no external state beyond the proforma invoice generated at placement.
 * The order is left in `paymentStatus='awaiting_payment'` until an admin
 * marks it paid via `POST /api/v1/admin/orders/:id/payment-status`.
 *
 * Captured here so the file layout matches T141's "drivers/" directory
 * convention; a future order-service refactor can dispatch through a
 * registry that lives next to it.
 */

export interface BankTransferReserveResult {
  paymentRef: null;
  nextAction: { kind: 'awaiting_transfer'; iban: string | null; reference: string };
}

export class BankTransferDriver {
  readonly kind = 'bank_transfer' as const;

  reserve(input: { orderId: string; iban?: string | null }): BankTransferReserveResult {
    return {
      paymentRef: null,
      nextAction: {
        kind: 'awaiting_transfer',
        iban: input.iban ?? null,
        reference: `ORDER-${input.orderId.slice(0, 8).toUpperCase()}`,
      },
    };
  }
}
