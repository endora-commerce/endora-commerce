---
'@endora-commerce/contracts': minor
---

Three additions, all for the same reason: a composition root may no longer be the place a
module's rule lives.

**`CustomerRollupScopePort`** (container name `customerRollupScopePort`, owner
`customer_accounts`) — whether a customer login widens from single-org to its
organization's subtree, and the widened id set when it does.

```ts
const rollup = await customerRollupScopePort.resolveSubtreeIds(customerAccountId, organizationId, (id) =>
  organizationTree.subtreeIds(id),
);
```

The traversal arrives as an argument rather than being resolved inside the owner: the caller
already holds it, and `organizations` publishes no contract for it.

**`SettingsManifestCollectionPort`** and **`SettingsManifestSource`** (container name
`settingsManifestCollectionPort`, owner `settings`) — how a module registry becomes the
boot-time reconcile's list of settings manifests: the settings module first, each module
code once. The registry stays the caller's argument, because which modules a deployment
ships is a composition-root input.

**`FeedDeliveryError`** — moved here from `product_feeds`' delivery SPI, beside
`feedDeliveryFailureReasonSchema`, the closed reason set it carries. It is re-exported from
its old location, so no import breaks.

It moved because a delivery adapter is a **contribution** and its author is not always the
module: `DeliveryService` classifies a transport refusal with `instanceof FeedDeliveryError`,
so a thrower that reached the class through a second copy of the module's sources would have
had every declared refusal silently reclassified as a retryable `internal_error`. This
package is resolved once, so the comparison holds.
