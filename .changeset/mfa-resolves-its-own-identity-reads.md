---
'@endora-commerce/mod-mfa': minor
---

`mfa` resolves its own identity reads; `MfaActorBridge` is gone.

The exported `MfaActorBridge` interface is **removed**. A composition no longer
contributes `mfaActorBridge`, and the module resolves the six answers itself:
`customerActorResolver` and `adminContextResolver` off the container, and
`customerAccountReadPort`, `adminUserReadPort`, `customerPasswordVerificationPort`
and `adminPasswordVerificationPort` through `lazyPort`. Both owners are already in
this module's manifest `dependencies`.

Consumers of `mfaModule`'s option object: `resolveAdminActor`,
`resolveOrganizationCustomerIds`, `resolveOrgAdmin`, `resolveAccountEmail` and
`verifyAccountPassword` are now **required** where they were optional. The
optionality was a live divergence rather than a capability — the two composition
roots disagreed about the last two, so under test an authenticator entry was
labelled with the account id instead of its e-mail address and the password branch
of the 2FA-disable re-authentication did not exist.

Before:

```ts
composedModules.contribute({
  mfaActorBridge: { resolveCustomerActor, resolveAdminActor, resolveOrgAdmin, /* … */ },
});
```

After: contribute nothing. `mfa` reads what it needs.
