---
'@endora-commerce/platform': minor
---

**Side-table entity extensions: the platform's host list and refusals** (issue #1834, `specs/187-side-table-extensions/`). `ENTITY_EXTENSION_HOSTS` maps each extensible host's `<ownerModuleId>.<EntityClassName>` reference (`organizations.Organization`, …, all nine custom-field hosts, with no rollout constant) to an `EntityExtensionHost` (`ExtensibleHost` plus `entityClassName`). `EntityExtensionInvalidError`, `EntityExtensionDriftError` and `EntityExtensionLoaderOutputError` are the refusals of the mechanism; each names the module, its origin, the side table, the host and the remedy.
