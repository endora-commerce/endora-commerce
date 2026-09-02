---
'@endora-commerce/mod-orders': major
'@endora-commerce/mod-search': major
'@endora-commerce/mod-prompt-actions': major
'@endora-commerce/mod-product-feeds': major
'@endora-commerce/mod-pim-pimcore': patch
---

Four promise-form `catch`es stop swallowing `ModuleDisabledError`. Each is a call that
answered "there is nothing here" for a capability the operator had switched off, and each
therefore has a new contract for its caller.

**Breaking — `OrderConfirmationService.resolveAdditional(organizationId, salesChannelId)`.**
It documented "invalid or empty entries are dropped, never fatal" and returned `[]` for any
failure of the organisation read, which goes through `organizationDetailsPort`. It now
rejects with `ModuleDisabledError` when `organizations` is absent and still returns `[]` for
every other failure.

    // before — an order confirmed with the buyer as its only recipient
    const extra = await confirmation.resolveAdditional(orgId, channelId);

    // after — the caller decides, because it can now tell the two apart
    let extra: string[];
    try {
      extra = await confirmation.resolveAdditional(orgId, channelId);
    } catch (error) {
      rethrowIfModuleDisabled(error);
      throw error;
    }

**Breaking — `resolveEmbedderConfig(settings, channelId, credentials)`.** It returned the
empty config, which every caller reads as "LLM search is not configured", for an absent
`credentials` module as well as for an unset reference. It now rejects with
`ModuleDisabledError` for the first and still returns the empty config for the second.

**Breaking — `LlmProviderFactory.capability()` and `.resolve()`.** `capability()` reported
`not_configured` and `resolve()` threw `AssistantNotConfigured` when `credentials` was
absent, sending the operator to configure a credential that was already configured. Both now
let `ModuleDisabledError` through.

**Breaking — `DeliveryConfigService.remove(productFeedId)`.** The credential cleanup after
the configuration delete absorbed everything. It now rejects with `ModuleDisabledError` when
`credentials` is absent — the configuration row is gone and its secret is not, and a retry
cannot reach the secret because the code that named it went with the row. A credential that
is merely already gone is still tolerated.

`@endora-commerce/mod-pim-pimcore` is a rename with no API surface: one file-scoped `worker`
binding becomes `deliveryWorker`.
