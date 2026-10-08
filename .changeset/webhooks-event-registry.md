---
'@endora-commerce/mod-webhooks': minor
---

Other modules can offer event types of their own as outbound webhooks.

`webhookEventRegistry` (`WebhookEventRegistryPort`) is a new container name: a module pushes
`{ ownerModuleId, eventType }` from a boot hook and declares the edge as
`nonBindingDependencies: [{ moduleId: 'webhooks', name: 'webhookEventRegistry', kind: 'contributes-to' }]`.
Each contributed type is bridged to the delivery queue through this module's own gated
subscription, and its payload is sent whole — so an event a module offers is that module's
public contract. `GET /api/v1/admin/webhooks/event-types` (`integrations:manage`) lists the
contributed types whose owner is switched on, and the subscription form offers them after its
own list. While an owner is switched off its types are not offered; subscriptions naming them
are kept and receive nothing.

Nothing changes for an instance in which nobody contributes: the two built-in event types and
the form's own list are as they were.
