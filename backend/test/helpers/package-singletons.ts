import type { AwilixContainer } from 'awilix';

import type { PaymentAdapterRegistry } from '../../../packages/modules/payment_methods/src/backend/services/payment-adapter-registry.js';

/**
 * How a test reaches a **module package's** process singleton.
 *
 * D-160.6 is usually told about entity classes: the ORM registered the class
 * behind `dist`, so a relative import into the package's source hands `em.find`
 * a class it never discovered. The same mechanism applies, unchanged, to any
 * **module-scope value** a package exports — and there it is worse, because the
 * failure is silent rather than a lookup miss.
 *
 * `payment_methods` exports `paymentAdapterRegistry`, one `PaymentAdapterRegistry`
 * instance the whole platform shares (feature 034). Once the module is a
 * package, `src/backend/index.ts` imports it from `./services/registry-singleton.js`
 * and that resolves inside `dist`, which is the instance
 * `ctx.di.register('paymentAdapterRegistry', …)` publishes and the instance every
 * gateway module's boot hook pushes into through the cradle. A test that
 * `import`s the same name from the package's **source** gets a *second*, empty
 * instance — `ownerOf('stripe')` answers `null`, `list()` answers `[]`, and the
 * assertion reads as "the gateway did not register" rather than as "you are
 * holding the wrong object". Seven integration files failed exactly that way
 * when the batch moved.
 *
 * So the value comes from the **composed container**, which is where the
 * platform itself gets it, and the type comes from an `import type` of the
 * source, which erases and constructs nothing. That split is the same one
 * `package-entities.ts` makes, for the same reason and with the same limit: a
 * stranger cannot write the type import, because an installed package ships
 * `dist` behind an `exports` map that refuses a deep path for types as well as
 * for values.
 *
 * There is no fallback. A container that does not hold the name throws here,
 * because the alternative — importing the source copy — is the defect this file
 * exists to prevent, and an empty registry is indistinguishable from a correct
 * one that nobody contributed to.
 */
export function paymentAdapterRegistryOf(container: AwilixContainer): PaymentAdapterRegistry {
  return container.resolve<PaymentAdapterRegistry>('paymentAdapterRegistry');
}
