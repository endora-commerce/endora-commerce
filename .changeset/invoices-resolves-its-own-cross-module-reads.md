---
'@endora-commerce/mod-invoices': major
---

Removed the `InvoicesBridge` interface and the `invoicesBridge` container name; `invoices`
resolves its cross-module dependencies itself.

**If you composed this module**, delete your `invoicesBridge` contribution. There is no
replacement name and nothing to supply: `registerModule` now reads the platform's own
`adminContextResolver` and `customerContextResolver` from the cradle, reads
`transactional_emails`' `transactionalEmailSenderAccessor`, and resolves
`customerAccountReadPort` and `assetReadPort` through `lazyPort`. The channel's language is a
read of the platform's `SalesChannel`, which is what both composition roots did.
`ksefVerificationResolver` is unchanged and is still the one thing a composition supplies for
this module.

Six option changes come with it, all on `InvoicesModuleOptions` (internal to the package and
reachable only through `./backend`):

- `resolveAdminUserId`, `resolveCustomerContext`, `getTransactionalEmailSender`,
  `resolveRecipientEmail`, `resolveLanguage` and `loadAssetImage` are now **required**. Each
  was optional because the *contribution* was, which was never true of the module — and an
  option no composition may decline to supply is a branch no test can drive. It was not
  hypothetical: `emailDispatcher` was built only when three of them were present, so a
  composition missing one silently stopped sending invoices and answered `no_sender`, and
  `loadAssetImage` was omitted by one of the two roots outright.
- `InvoicesModuleHandle.emailDispatcher` is therefore **no longer optional**, and the handle
  gains `loadAssetImage` — the composed loader, which is otherwise held privately by the PDF
  renderer.
- `LoadedAssetImage.bytes` is `Uint8Array` rather than `Buffer`, following
  `assetReadPort.openAssetBytes`. A `Buffer` still satisfies it, so a caller that passes one
  needs no change; a caller that *reads* one and called a `Buffer` method does.

New export on `./backend`: `services/cross-module-context.js`'s
`createRecipientEmailResolver`, `createChannelLanguageResolver` and `createAssetImageLoader` —
the three mappings the bridge held, as functions of what they read, so they are testable with
nothing composed.

`assets_library` and `customer_accounts` join the manifest `dependencies`. Both are binding
and neither costs an operator a control: both declare `activation.nonDeactivatable`, so there
is no switchable owner for a `refuses-without` sentence to describe.
