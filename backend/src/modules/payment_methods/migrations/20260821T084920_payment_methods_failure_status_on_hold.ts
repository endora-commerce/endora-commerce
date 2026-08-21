import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 085 (FR-003 / FR-005) — a declined payment holds the order instead of
 * ending it.
 *
 * `status_on_failure` was seeded `cancelled`: the settlement ingress applied it
 * on the first decline, `cancelled` is terminal and cannot be left, and the
 * buyer's most recoverable mistake destroyed the order they were trying to pay
 * for. The shipped default is now `on_hold`, which is a system status —
 * reachable from every non-terminal status, able to reach every status, and
 * neither it nor its edges can be deleted by an operator.
 *
 * ### Why this is one of five migrations rather than the only one
 *
 * `stripe`, `payu`, `tpay` and `autopay` each declare `payment_methods` in
 * their manifest `dependencies`, and feature 081 orders migrations module by
 * module along that graph — so this file runs **before** all four gateway seed
 * migrations. On a fresh database it therefore normalises nothing and the
 * gateways would insert `cancelled` after it. Each of the four carries its own
 * normalisation, stamped after its own seed. This one is the base: every row
 * that exists by the time `payment_methods` migrates, which on an existing
 * installation is the operator-created rows, the built-in bank-transfer /
 * pickup / credit-limit rows the reconciler created at boot, and the gateway
 * rows already seeded there.
 *
 * ### What it costs
 *
 * There is no provenance column, so `where status_on_failure = 'cancelled'`
 * cannot tell a seeded default from an operator who deliberately chose to
 * cancel on failure, and it overwrites the latter. That is acceptable only
 * because there is no production deployment yet (research R9); after the first
 * one this becomes a data migration requiring operator notification.
 */
export class Migration20260821T084920PaymentMethodsFailureStatusOnHold extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      update "payment_methods"
      set "status_on_failure" = 'on_hold', "updated_at" = now()
      where "status_on_failure" = 'cancelled';
    `);
  }

  /**
   * Deliberately empty. The inverse — putting `cancelled` back on every row
   * that now reads `on_hold` — cannot distinguish the rows this migration moved
   * from the rows an operator has since set to `on_hold` themselves, so it
   * would silently take a choice away. The forward statement is idempotent and
   * the value is operator-configurable; a deployment that wants `cancelled`
   * back sets it on the method.
   */
  override async down(): Promise<void> {
    // No inverse — see the note above.
  }
}
