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

`POST /api/v1/storefront/pwa/subscriptions` updates an endpoint that is already registered only
for that same party.

The route upserted on `endpoint`: any caller could send new keys for a registered endpoint and
the row took them, together with the caller's account or none. An existing row is now updated
only when the caller proves ownership the same way: the owning customer's session, or — for a
row no account owns — the row's current keys in the request. So:

- the same browser subscribing again with unchanged keys is `200` with the same `id`, as before;
- a signed-in customer subscribing a device that was subscribed anonymously, with its keys,
  claims the row (`200`). This answered `409` before, because the lookup ran in the customer's
  tenant scope and did not see the ownerless row;
- new keys for an endpoint a customer owns are accepted from that customer's session (`200`);
- anything else is answered `201` with a fresh `id`, exactly like a first subscribe, and writes
  nothing. That includes a signed-out browser re-subscribing an endpoint a customer owns — the
  row no longer loses its account that way — and an anonymous browser whose keys changed for
  the same endpoint: it is not re-keyed, and the stale row goes when the push service reports
  it gone.

The answer to a refused request is the answer to a first subscribe for one request. A caller
that repeats it is answered `201` again, where a row of its own would answer `200`.

**Breaking for a custom storefront client**: an anonymous unsubscribe that sends the endpoint
alone is now a no-op. Send the keys from `PushSubscription.toJSON()` with it. The bundled
storefront's `unsubscribeFromPush()` does so already; an instance that copied
`storefront/lib/api/pwa.ts` should take the same change.

Both lookups by `endpoint` run under a system tenant scope, with ownership checked explicitly.

`PushSubscriptionDeleteSchema` (`@endora-commerce/contracts`) gains the optional `keys` object,
and `PushSubscriptionService.revoke` takes a second argument naming the caller's session
account and the presented keys.
