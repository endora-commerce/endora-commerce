---
'@endora-commerce/mod-product-feeds': patch
---

On a deployment without Redis, where a published feed is delivered inline, a switched-off `credentials` module is now recorded as a failed delivery attempt (`not_configured`) whose detail names the module, instead of being discarded with no attempt row. `DeliveryService` gains `deliverInline(request)` for that path; `deliver(request)` is unchanged and still throws `ModuleDisabledError`, so the queued path keeps failing its job.
