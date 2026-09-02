---
'@endora-commerce/contracts': patch
---

`PimConnectorRegistryPort` names its container binding

The interface carried no `Container name:` line, so nothing tied it to the
`pimConnectorRegistryPort` registration `@endora-commerce/mod-pim-connector` makes. That
name is the whole of the promise the port makes: `lazyPort<T>` is `new Proxy({} as T, …)`,
so `T` is asserted and compared to nothing that is registered, and a consumer copying the
owner's class registration instead would compile and receive the service with no
`MODULE_DISABLED` gate on it. Documentation only — no type, no member and no runtime
behaviour changes.
