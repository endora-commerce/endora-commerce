---
'@endora-commerce/cli': patch
'@endora-commerce/platform': patch
---

`check:platform-surface` gains a signal for issue #84: a name the platform's published barrels export and a workspace package the platform depends on (`@endora-commerce/contracts`) also exports must resolve to that package's own declaration, or it is a finding. `@endora-commerce/cli/rules/platform-surface.js` exports `scanSharedNames`, `checkSharedNames`, `sharedNameRefusal`, `sharedNameRemedyOf` and `dependencyDeclarations`, with the `SharedNameInput`, `SharedNameFinding`, `SharedNameFindingKind`, `SharedNameScan`, `SharedNameResult` and `LedgeredSharedName` types.

`@endora-commerce/platform`: the lifecycle orchestrator's optional `log` dependency is typed as the contracts' `ModuleLifecycleLogger` instead of an inline copy of the same shape. Structurally identical, so no caller changes.
