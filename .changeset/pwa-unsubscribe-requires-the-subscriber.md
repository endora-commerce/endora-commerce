---
'@endora-commerce/mod-pwa': minor
'@endora-commerce/contracts': minor
---

`DELETE /api/v1/storefront/pwa/subscriptions` removes a push subscription only for the party
that created it.

The route took `{ endpoint }` and deleted the matching row for any caller. It now deletes:

- a subscription a customer account owns — only when the request carries that customer's
  session;
- a subscription no account owns — only when the request also carries the subscription's own
  keys, `{ endpoint, keys: { p256dh, auth } }`, the same object the browser sent when it
  subscribed. The keys are compared in constant time.

The answer is `204` in every case, as it already was for an unknown endpoint, so it does not say
whether an endpoint is registered.

**Breaking for a custom storefront client**: an anonymous unsubscribe that sends the endpoint
alone is now a no-op. Send the keys from `PushSubscription.toJSON()` with it. The bundled
storefront's `unsubscribeFromPush()` does so already; an instance that copied
`storefront/lib/api/pwa.ts` should take the same change.

`PushSubscriptionDeleteSchema` (`@endora-commerce/contracts`) gains the optional `keys` object,
and `PushSubscriptionService.revoke` takes a second argument naming the caller's session
account and the presented keys.
