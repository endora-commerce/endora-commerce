---
'@endora-commerce/mod-orders': minor
---

`orders` resolves the three registries it reads from `payment_methods` and
`delivery_methods` per read, behind the presence probe its `degrades-without`
declarations already promise (D-228).

`OrdersModuleOptions`' `paymentAdapterRegistry`, `shippingAdapterRegistry` and
`paymentOrderStatusRegistry` now return `T | null`, and `OrderService`'s
`paymentDeps` takes the three as accessors rather than as values. A consumer
composing the module through `registerModule` is unaffected; a consumer
constructing `OrderService` directly passes `paymentAdapters: () => registry`
where it passed `paymentAdapters: registry`.

The plugin body no longer invokes the accessors. It ran under `avvio` while
routes were being registered, so the container was asked before any request
existed: a composition that never installed the owner threw
`AwilixResolutionError` instead of degrading, and the one answer it did get was
frozen for the life of the process, leaving placement dispatching through a
table an operator had switched off.
