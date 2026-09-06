---
'@endora-commerce/contracts': major
'@endora-commerce/platform': major
---

Removed the module licence tier: `ModuleLicenseTierSchema`, the `ModuleLicenseTier` type, the
optional `license` field on a module manifest, and the required `license` field on
`ModuleListItem`.

It was reserved for edition-gating and was read by nothing. D-194 removed the tier
meta-packages it existed for, and the field survived them: no gate consulted it, no route
branched on it, the `/platform/modules` screen never rendered it, and `module:status` never
printed a column for it. The only two references outside its own declaration were the
orchestrator lines copying it from the manifest onto the list item — a value carried the
length of the system so that nobody could look at it.

**If you declared it in a manifest**, delete the line. A Zod object is non-strict, so a
manifest that still declares one is not refused; the key is dropped on parse. There is no
replacement, and there is no entitlement axis to move it to — the manifest's one presence
declaration is `activation`, which is the operator's runtime control and was always a
different question (Constitution XVII).

```diff
 export const manifest = defineModuleManifest({
   id: 'my_module',
   name: 'My Module',
   version: '1.0.0',
   dependencies: [],
-  license: 'pro',
   activation: { settingCode: 'my_module.enabled', default: true },
 });
```

**If you read `ModuleListItem.license`**, the field is gone from
`GET /api/v1/admin/modules` and from `ModuleLifecycleOrchestrator.status()`. Nothing
replaces it. A consumer that rendered it was rendering `null` for every module in this
repository, no manifest having ever declared a tier.

```diff
-import type { ModuleLicenseTier } from '@endora-commerce/contracts';
-const tier: ModuleLicenseTier | null = item.license;
```
