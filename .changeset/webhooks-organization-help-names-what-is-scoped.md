---
'@endora-commerce/mod-i18n': patch
---

The Webhooks form says which events an Organization binding applies to.

The help under the Organization field said a bound subscription receives "only that organization's
order events". Quote-request and credit-limit events are delivered now and are scoped the same way,
and product events are not about an Organization at all: they reach platform-wide subscriptions
only. The English and Polish sentences say so.
