---
'@endora-commerce/platform': minor
---

`@endora-commerce/platform/lifecycle` carries `runInstanceOperatorCommand` and
no longer carries `instanceOperatorRuntime`, `instanceManifestEntries` or
`InstanceOperatorRuntimeOptions`.

The one an instance imports is `runInstanceOperatorCommand`, which is what the
`backend/src/module-commands/runtime.ts` that `endora new instance` renders
calls, and it is unchanged. The other three were published in the same release
and no consumer outside the platform ever named one: they remain exported from
`lifecycle/commands/operator-entry.js` for the platform's own use, and a merge
request that gives one of them a consumer out here puts it back on the barrel in
the same breath. A client who imported one directly — nobody does, the symbols
are one release old — takes `runInstanceOperatorCommand` instead, which builds
the runtime, runs the body under a system scope, disposes and exits.
