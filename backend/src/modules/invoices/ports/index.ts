/**
 * The port interfaces `invoices` publishes whose signature carries a MikroORM
 * `EntityManager`, and **nothing that exists at runtime** (feature 080, T048;
 * D-169, D-171).
 *
 * `tsc` compiles this file to `export {};`. That is the property D-171 makes
 * the boundary decision on — *a subpath is contract surface iff the module it
 * resolves to exports no runtime binding* — and it is why this declaration has
 * its own file rather than sitting on top of a service module, which exports
 * the class beside it. A consumer naming that file names the owner's
 * implementation, whatever `import type` erases; a consumer naming this one
 * names a declaration and can name nothing else.
 *
 * **This is not yet a supported specifier and the ledger still counts it.**
 * `invoices` is not a workspace package, so there is no `exports` map for this
 * to be a subpath of, and `check:module-boundary` reads `orders`' relative
 * import exactly as it read the entity import it replaces — D-171 says so in as
 * many words: `resolveModulePackage` returns `null` for any specifier starting
 * with `.`, so an unconverted reach has no subpath for the exemption to apply
 * to, and reaching the exempt state takes three separable edits (package the
 * owner, publish the interface, rewrite the specifier). This file is the second
 * of those three, taken early because it is the one that does not need the
 * module to move.
 *
 * The rest of this module's surface is in `@endora-commerce/contracts` and
 * belongs there — `InvoiceReadPort`, `InvoicePdfPort`, `CorrectiveInvoicePort`
 * are contract DTOs end to end. This one qualifies for `./ports` on D-171's own
 * test — *"does this signature stop the interface living in
 * `packages/contracts`"* — and the answer is its `EntityManager` parameter,
 * which that package may not name because `admin` and `storefront` both compile
 * it (FR-034).
 *
 * No entity class leaves by this door, type-only included (D-168).
 */
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * What {@link InvoicePlacementApplyPort.createProformaForOrder} answers — a
 * published record and never the managed entity (D-77's first narrowing).
 * `orders` reads nothing off it today; it is returned so that the caller can
 * tell "opened" from "the owner is absent and opened nothing", which is a state
 * this seam really has.
 */
export interface ProformaInvoiceOpened {
  readonly id: string;
  readonly orderId: string;
  readonly number: string;
}

/**
 * Container name: `invoicePlacementApplyPort`. Owner: `invoices`.
 *
 * The proforma document order placement opens, written on the **caller's**
 * `EntityManager` (D-169). `orders` is the one consumer, and it makes one call.
 *
 * **The seam is not a defect in the design, it *is* the design.**
 * `invoices_order_fk` (`invoices.order_id` -> `orders.id`, `on delete restrict`,
 * `db/migrations/20260425T050720_core_commerce_init.ts`) means the row cannot
 * exist before its order does, and the order does not commit until placement
 * returns — so a port that opened its own transaction could not satisfy a
 * foreign key against a row it cannot see. A foreign key needs the **table**
 * and never the class (D-169), so that constraint stands while this module
 * publishes no entity class by name.
 *
 * **The read half is not here.** The customer download and the admin bulk print
 * go through `InvoiceReadPort` / `InvoicePdfPort` in
 * `@endora-commerce/contracts`, and a read handed an `EntityManager` would be a
 * write seam re-opened to serve a read (D-169).
 *
 * **Owner off:** this module is switchable (`invoices.enabled`), and `orders`
 * declares the edge `degrades-without` rather than binding it — an acknowledged
 * edge would keep the bind and make that control unusable, because `orders` is
 * non-deactivatable. So placement asks `effectiveState.isPresent('invoices')`
 * and, when the answer is no, opens no proforma and changes nothing else about
 * the order. That is what the setting's own description promises an operator —
 * *"switches invoice issuance … on or off"* — and it is what the platform did
 * **not** do before T048: the row was written straight into this module's table
 * while the operator had switched it off, which is the shape issue #188 names.
 */
export interface InvoicePlacementApplyPort {
  /**
   * Open the proforma an order is placed with.
   *
   * `em` is **required** (D-169). Its one caller is `placeOrder`, which always
   * passes the `EntityManager` its own transaction runs on; an optional
   * parameter is what lets the same method double as a standalone transaction,
   * and that is a lie about a seam a foreign key holds together.
   */
  createProformaForOrder(
    em: EntityManager,
    input: { orderId: string; currency: string; total: string },
  ): Promise<ProformaInvoiceOpened>;
}
