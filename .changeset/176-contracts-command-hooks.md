---
'@endora-commerce/contracts': minor
---

**Command hooks: the platform-free half** (`specs/176-command-hooks-outbox/` P2).

- **`command-hooks.ts`** (re-exported from the package root): `hookableAction<TData, TOutbox>(action, objectType, phases)` builds a `HookableActionRef` an owner publishes for a Command it opens to hooks; `toHookableActionDeclaration(ref)` turns it into its manifest entry, validated by `HookableActionDeclarationSchema`. `CommandHookPhase` (`'beforeCommit' | 'afterCommit'`), `OutboxScalar` / `OutboxData` (audit-state list 1 only), `COMMAND_HOOK_ERROR_CODES`, `COMMAND_HOOK_MAX_DEPTH` (8), and the execution-plan response `CommandHookPlanResponseSchema` (`GET /api/v1/admin/command-hooks`).
- **`ERROR_CODES`** gains `COMMAND_EXTENSION_UNCLAIMED` (422), `COMMAND_HOOK_CYCLE` (500) and `COMMAND_HOOK_DATA_MISSING` (500).
- **`ModuleManifestSchema.hookableActions`** — optional list of declarations; `defineModuleManifest` refuses one action listed twice.
- **`DivergenceKind`** gains `'command-hook'`, with a `DivergenceDetail` of `{ kind: 'command-hook', phase, id }`; its report key is `command-hook:<module>:<action>#<id>`.
- **`DeploymentDivergenceDeclarationSchema.commandHookOrder`** — optional `Record<action, moduleId[]>` (two or more), the deployment's tie-break for two hook modules no dependency orders. Optional rather than defaulted, so an existing typed `divergence.ts` keeps compiling.
- **`ORGANIZATION_HOOKABLE_ACTIONS`** — `create`, `register`, `adminPatch` and `setCustomFieldValues`, both phases each, with `OrganizationCreateHookData`, `OrganizationRegisterHookData`, `OrganizationUpdateHookData` and the three `Organization*Outbox` types.
