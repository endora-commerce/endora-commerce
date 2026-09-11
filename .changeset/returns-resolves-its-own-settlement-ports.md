---
'@endora-commerce/mod-returns': minor
---

Removed `ReturnsBridge` from `@endora-commerce/mod-returns/backend`, and with it every
name a composition root had to contribute for this module.

The bridge carried eight members and none of them was a composition's answer to give.
`orderContext`, `paymentRefund`, `correctiveInvoice` and `creditTopup` were forwarders
onto `orderReturnContextPort`, `paymentRefundPort`, `correctiveInvoicePort` and
`creditTopupPort`; the module resolves those four itself now, with `lazyPort`, and
declares each edge in its manifest — `orders` and `customer_accounts` in `dependencies`,
and `payments`, `invoices` and `credit_limits` as `refuses-without`
`nonBindingDependencies`, because settling a return is a choice among resolutions and
switching one owner off must stop that resolution rather than the module.
`resolveCustomerEmail` is `customer_accounts`' published `customerAccountReadPort`,
`resolveChannelLanguage` is a read of the platform's own `SalesChannel`, and
`resolveCustomerAccountId` / `resolveAdminUserId` are the platform's own
`customerAccountIdResolver` and `adminContextResolver` under a second pair of names.

**If you contributed `returnsBridge`**, delete the contribution: the container name is
read by nobody and registering it now does nothing. There is no replacement to write.
Make sure the composition registers `customerAccountIdResolver` and
`adminContextResolver` — `@endora-commerce/platform`'s `composeApp` contributes both, so
a platform-composed deployment already has them.

`ReturnCommentNotifier` and `ReturnCommentServiceDeps.notifier` are removed in the same
change. The optional notifier was declared, guarded and supplied by nobody — `plugin.ts`
builds `ReturnCommentService` with `emFactory` and `graphService` and no third member —
so its body was unreachable. Sending on a customer-visible comment is a product decision
that has not been taken; when it is, it takes a notifier a composition really supplies.
