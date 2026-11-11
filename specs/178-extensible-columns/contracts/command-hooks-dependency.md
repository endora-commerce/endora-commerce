# Contract: What 178 consumes from spec 176 (command hooks)

Reconciled on 2026-11-10 against `../wt-176-command-hooks-outbox/specs/176-command-hooks-outbox/
contracts/command-hooks-api.md` and `organization-hookable-actions.md` (draft, unmerged). If 176
changes before it merges, the developer re-reconciles this file before Phase B's T046; a change that
alters 178's behaviour goes back to the architect.

## 1. The 176 surface used

- `ctx.commandHooks([{ id, on: <HookableActionRef>, phase: 'beforeCommit', handler }])` on
  `ModuleContext` (kernel). The ref is the owner's published `hookableAction(...)`; for
  organizations: `create` (`organization.create`), `register` (`organization.register`),
  `adminPatch` (`organization.admin_patch`), `setCustomFieldValues`.
- `CommandHookContext<TData>`: `em` (the Command's transaction), `objectId`, `data`, `extension`
  (the caller's `command.extensions[<this module>]`, unvalidated), `module.id`,
  `noteAuditChanges(fields)`, `run(child)`.
- Semantics: hooks of a module not present are dropped (XVII); a throw rolls back; changed field
  **names** land in the owner's single audit entry as `stateAfter.extensions.<moduleId>.changedFields`
  — never values (`specs/conventions/audit-state.md`, D-288). An unclaimed `extensions` key → 422
  `COMMAND_EXTENSION_UNCLAIMED`.

## 2. Consequences for 178 (applied to spec, contracts and tasks)

1. **Audit is names-only.** `extensionColumns(…).set` returns `{ changedFields: string[] }` (sorted
   declared keys whose value changed), not before/after values. An extension's own Command records
   `after: { extensions: { <moduleId>: { changedFields } } }`; a hook calls
   `ctx.noteAuditChanges(changedFields)`. This satisfies OR-7's "one audit entry" without the
   `contributeAudit` assumption (former OD-178-2 is closed).
2. **Row visibility in a hook.** `set` reads through `em.find` with the default `FlushMode.AUTO`, which
   flushes the Command's pending INSERT first, so a create/register hook finds the new row.
   Asserted by T046.
3. **Standard hook helper (new, Phase B).** The platform publishes
   `columnExtensionHook(decl, { id, on })` on `./kernel`, returning a `CommandHookEntry` whose
   handler: validates `ctx.extension` with `columnExtensionPatchSchema(decl)` (absent → no-op;
   invalid → 422 `SCHEMA_EXTENSION_INPUT_INVALID` with Zod paths under `extensions.<module>`),
   calls `set(ctx.objectId, patch)` on `ctx.em`, then `ctx.noteAuditChanges(changedFields)`. A module
   registers it with `ctx.commandHooks([columnExtensionHook(acmeOrganizationColumns, { id:
   'erp-columns', on: organizationHookableActions.adminPatch })])`. Custom logic is an ordinary hook
   that calls the accessor itself.
4. **HTTP `extensions` body field: not added in 178** (FR-061, OD-178-6). 176 leaves the decision to
   178. Server-side callers (ports, overlays, the instance's own routes) can already pass
   `command.extensions`; the core admin form has no way to fill it, so an HTTP field would serve API
   clients only. Recommended follow-up once a host form can carry zone-contributed fields.

## 3. Example (fixture, Phase B)

```ts
ctx.commandHooks([
  {
    id: 'onboarded-via-admin',
    on: organizationHookableActions.create,
    phase: 'beforeCommit',
    handler: async (h) => {
      const { changedFields } = await extensionColumns(acmeOrganizationColumns, h.em)
        .set(h.objectId, { onboardedVia: 'admin' });
      h.noteAuditChanges(changedFields);
    },
  },
  columnExtensionHook(acmeOrganizationColumns, { id: 'erp-columns', on: organizationHookableActions.adminPatch }),
]);
```

The fixture's manifest declares `dependencies: ['organizations']` (176 `HookOwnerNotDependedOnError`
and 178 V10 both require it).
