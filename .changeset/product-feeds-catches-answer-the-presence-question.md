---
'@endora-commerce/mod-product-feeds': major
---

Four `catch` blocks in this module stop swallowing `ModuleDisabledError`, and
`DeliveryService.deliver` therefore has a new contract.

**Breaking — `DeliveryService.deliver(request)`.** It documented "never throws" and
returned `{ status: 'failed', failureReason: 'internal_error' }` for anything that went
wrong, including a switched-off `credentials`. Every delivery target's password lives in
that module (FR-107), so `resolveTarget` goes through `credentialsService`; an operator who
withdrew the capability was told this module had a defect, and every retry said it again.
It now re-throws `ModuleDisabledError` and absorbs everything else exactly as before.

    // before — one call site, and it could not tell the two apart
    const outcome = await delivery.deliver(request);
    if (outcome.status === 'failed') retryOrGiveUp(outcome);

    // after — the presence answer is not an outcome
    let outcome;
    try {
      outcome = await delivery.deliver(request);
    } catch (error) {
      rethrowIfModuleDisabled(error); // or let it reach the caller, which is the point
      throw error;
    }
    if (outcome.status === 'failed') retryOrGiveUp(outcome);

The BullMQ consumer needs no change: the throw is the retry request it already speaks, and
no attempt row is written for an attempt that never resolved a target.

`FeedGenerationService.generateNow` and `TaxonomyRefreshService.runCheck` gain the same
one exception. A presence answer has no honest `FeedRunFailureCode` and no honest
`FeedTaxonomyCheckReason` — the run did not fail, the platform declined to assemble it —
so neither is recorded as one any more. The claimed run row is left `running` for
`FeedRunReaperService`, which already owns exactly that case.

**New export — `productFeedsSettingsAccess(settings)`** and its
`ProductFeedsSettingsAccess` type. The module's four typed settings readers, previously an
object literal inside `productFeedsModule`. They answer the manifest default for a setting
the boot reconciler has not written yet, and re-throw `ModuleDisabledError`; `settings`
declares `activation.nonDeactivatable`, so the second half is unreachable today and is
written now rather than left for whoever withdraws that lock.

`reconcileSchedulers`' first parameter is renamed `backend` -> `schedulers`, positional and
therefore not a call-site change.
