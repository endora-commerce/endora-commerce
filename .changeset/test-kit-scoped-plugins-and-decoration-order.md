---
'@endora-commerce/test-kit': minor
---

`composeTestServer` gains two options and one ordering guarantee, all three found by making
this repository's own harness its first caller (feature 109, Phase 1c).

`decorationOrder` is forwarded to `composeModules` unchanged. It is the wrapping order an
instance declares for a name more than one module decorates (feature 107) — read from
`backend/src/apps/<deployment>/divergence.ts` here and from wherever an instance keeps it
elsewhere. It is **checked, never applied**: the composer emits in its own topological order
and drains decorations once, and `AmbiguousDecorationError` names this field when the two
disagree. It is an option rather than a fifth `PlatformComposition` member because that
type's four members are what a composition cannot be built without, and an instance that
declares no ambiguity resolution composes perfectly well.

`scopedPlugins` mounts route plugins **after** the request-scope hook, where `plugins`
mounts them before it. The scope sits in the middle of the chain rather than at its end, so
there are two sides to it and a caller needs both: authentication has to be ahead of the
hook, because the `TenantContext` is built out of the actor that hook resolves, and the
sales-channel resolver has to be behind it, because it writes the resolved channel into the
open scope and refuses when there is none. Production's own root has had exactly this shape
all along — `authModulePlugin`, `tenantContextModulePlugin`, `salesChannels.plugin`. With
one slot, every request through a kit-composed server carrying that resolver answered
`500 No request scope is open`.

Both arrays are now read **after** the contribution window closes rather than before it, so
a caller may push into either from inside `contribute`, where the value a plugin needs
finally exists. That is a guarantee rather than a placement, and it is what lets a caller
mount a plugin over a service the composed container only just produced.

```ts
await composeTestServer({
  composition,
  decorationOrder: divergence.decorationOrder,
  plugins: [authenticate],      // before the request scope
  scopedPlugins: laterPlugins,  // after it; may be pushed to from `contribute`
});
```
