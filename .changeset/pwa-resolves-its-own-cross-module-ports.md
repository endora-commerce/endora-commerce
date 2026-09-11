---
'@endora-commerce/mod-pwa': minor
---

Removed the `PwaBridge` interface and the `pwaBridge` container name; `pwa` resolves its
cross-module dependencies itself.

**If you composed this module**, delete your `pwaBridge` contribution. There is no
replacement name and nothing to supply: `registerModule` now resolves
`assetsLibraryPort`, the kernel's `salesChannelResolutionPort` and `orderReadPort` through
`lazyPort`, reads the platform's `adminAuditActorResolver` from the cradle, and reads
`request.actor` for the calling customer. `pwaRunWorkers` is unchanged and is still the
one thing a composition supplies for this module.

Two option changes come with it, both on `PwaModuleOptions` (which is internal to the
package and reachable only through `./backend`):

- `resolveChannelIdByCode` is **deleted**. Nothing called it: the three storefront routes
  read the platform's resolved request channel, so the option, the dependency field it
  was threaded into and the two closures that built it were dead the whole way down.
- `resolveOrderTarget` is now **required**, because the module resolves `orderReadPort`
  itself and no composition can decline to supply it. `resolveQuoteTarget` stays optional
  and is still supplied by nobody.

`orders` joins the manifest `dependencies`. It is binding and costs no operator a
control: `orders` declares `nonDeactivatable`.
