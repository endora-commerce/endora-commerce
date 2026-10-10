---
'@endora-commerce/mod-pwa': minor
'@endora-commerce/contracts': minor
---

`DELETE /api/v1/storefront/pwa/subscriptions` removes a push subscription only for the party
that created it.

The route took `{ endpoint }` and deleted the matching row for any caller. It now deletes it
only for a caller that holds the subscription:

- the request carries the subscription's own keys, `{ endpoint, keys: { p256dh, auth } }` — the
  object the browser sent when it subscribed, compared in constant time. This is enough whoever
  is or is not signed in, so a signed-out browser can still remove its own subscription;
- or the subscription belongs to a customer account and the request carries that customer's
  session, which needs no keys.

The answer is `204` in every case, as it already was for an unknown endpoint, so it does not say
whether an endpoint is registered.

`POST /api/v1/storefront/pwa/subscriptions` updates an endpoint that is already registered only
for that same party.

The route upserted on `endpoint`: any caller could send new keys for a registered endpoint and
the row took them, together with the caller's account or none. An existing row is now updated
only on the same proof — the row's current keys in the request, or the owning customer's
session. So:

- the same browser subscribing again with unchanged keys is `200` with the same `id`, as before;
- a signed-in customer subscribing a device with its keys takes the row — an anonymous one, or
  one another customer subscribed on that browser — and the account and organisation move
  together (`200`). This answered `409` or `500` before, because the lookup ran in the
  customer's tenant scope and did not see the row;
- a signed-out browser subscribing again with its keys detaches the row from the account, the
  organisation going with it (`200`), as before;
- new keys for an endpoint a customer owns are accepted from that customer's session (`200`);
- anything else — keys that are not the row's, without the owner's session — is answered `201`
  with a fresh `id`, exactly like a first subscribe, and writes nothing. That includes an
  anonymous browser whose keys changed for the same endpoint: it is not re-keyed, and the stale
  row goes when the push service reports it gone.

The answer to a refused request is the answer to a first subscribe for one request. A caller
that repeats it is answered `201` again, where a row of its own would answer `200`.

**Breaking for a custom storefront client**: an unsubscribe that sends the endpoint alone, with
no session of the owning customer, is now a no-op. Send the keys from `PushSubscription.toJSON()` with it. The bundled
storefront's `unsubscribeFromPush()` does so already; an instance that copied
`storefront/lib/api/pwa.ts` should take the same change.

The lookup by `endpoint`, and nothing else, runs under a system tenant scope in both routes;
ownership is then checked explicitly.

`PushSubscriptionDeleteSchema` (`@endora-commerce/contracts`) gains the optional `keys` object,
and `PushSubscriptionService.revoke` takes a second argument naming the caller's session
account and the presented keys.
