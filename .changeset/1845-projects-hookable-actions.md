---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-projects': minor
---

**Projects declare eight hookable actions** (issue #1845), so a deployment's overlay module or an installed package can take part in a Project write through a command hook: `projects.project.create`, `.update`, `.custom_fields_update`, `.organization_add`, `.organization_remove`, `.stage_move`, `.close` and `.reopen`, each for both phases (`beforeCommit` inside the write's transaction, with a veto that rolls it back; `afterCommit` through the platform's outbox).

`@endora-commerce/contracts` exports the refs as `PROJECT_HOOKABLE_ACTIONS` (`create`, `update`, `customFieldsUpdate`, `organizationAdd`, `organizationRemove`, `stageMove`, `close`, `reopen`) and their data types (`ProjectCreateHookData`, `ProjectUpdateHookData`, `ProjectCustomFieldsUpdateHookData`, `ProjectOrganizationHookData`, `ProjectStageMoveHookData`, `ProjectCloseHookData`, `ProjectReopenHookData`, and an `…Outbox` alias of each). Hook data and outbox rows carry ids, codes and field names only — `changedFields` and `changedCustomFields` name what changed, never its value; the title, description, value, custom-field values, Stage names and the loss comment are not in them. An Organization add or remove names the Organization as `targetOrganizationId`. No project outbox row is pinned to an Organization, because a project has none of its own; handlers run in system scope.

A hook module registers against these refs and lists `projects` in its manifest `dependencies`. Nothing changes for a deployment that registers no hook. No route or port passes `extensions` to these Commands yet.
