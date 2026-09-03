# Per-module AI-assistant command registration (feature 043)

The admin AI assistant (`prompt_actions`) executes **tools** — the only catalogue
of operations the interpreter may draw from. Any module can contribute its own
tools so its admin actions become assistant-invokable, **without `prompt_actions`
ever importing the module's internals** (adapter-registry pattern, Constitution
Principle I — mirrors the payment/shipping adapter registries).

## How a module registers its commands

1. **Add `packages/modules/<module>/src/backend/prompt-tools.ts`** exporting a
   provider function that returns a flat `PromptActionTool[]`:

   ```ts
   export function <module>PromptTools(deps): PromptActionTool[] {
     // construct the module's own services from deps.emFactory etc.
     return [ /* resolvers + mutations */ ];
   }
   ```

2. **Push them from the module's own boot hook** — a `ctx.onBoot` in
   `src/backend/index.ts` that reads `promptActionToolRegistry` off the cradle
   and registers each tool. The shared `PromptActionToolRegistry.register()`
   validates each one on insertion.

   ```ts
   ctx.onBoot(() => {
     const cradle = ctx.cradle<MyModuleCradle>();
     const registry = cradle.promptActionToolRegistry;
     for (const tool of <module>PromptTools({ emFactory: cradle.emFactory, /* … */ })) {
       registry.register(tool);
     }
   });
   ```

   It is a **contribution** hook and carries no presence probe (D-62/D-68): the
   registry is a plain registration, so nothing is resolved through a gate, and
   the host drops every tool whose recorded owner is not effectively present.

3. **Declare the edge as `nonBindingDependencies`, not `dependencies`** —
   `{ moduleId: 'prompt_actions', name: 'promptActionToolRegistry',
   kind: 'contributes-to', reason: … }` in your `src/manifest.ts`. Binding
   `prompt_actions` in `dependencies` would make an optional assistant
   undeactivatable while your module is present.

   This step used to read *"register it in `composition.ts` — append the provider
   to the `promptActionToolProviders` array"*. Feature 072 composes every module
   through the kernel container; that array no longer exists, and a composition
   root that built a module's services on its behalf is what the boot hook above
   replaced.

## The `PromptActionTool` contract

Published in `@endora-commerce/contracts` since feature 075 (D-75) — a contributor names
`PromptActionTool`, `ToolContext` and `PromptActionToolRegistryPort` from there
and never reaches into this module. The class that enforces the rules below
stays here (`packages/modules/prompt_actions/src/backend/services/tool-registry.ts`).

`ToolContext` carries `{ adminUserId, requestId, auditCtx }` and **no unit of
work**. A `preview()` reads committed rows through the contributing module's own
`emFactory`; an `execute()` goes through that module's own audited service,
which opens its own transaction. It used to carry the request path's
`EntityManager`, which no contributor wrote through and no transaction wrapped.

| Field | Rule |
| --- | --- |
| `id` | `'<moduleId>.<snake_case_name>'`, globally unique. |
| `moduleId` | Must equal the `id` prefix; gates visibility on module install state. |
| `kind` | `'resolver'` (side-effect-free, runs during interpretation) or `'mutation'`. |
| `description` | English, action-oriented — the LLM's **only** documentation. |
| `requiredPermission` | Mirror the permission guarding the equivalent manual admin route. |
| `paramsSchema` | A Zod schema (lives in `@endora-commerce/contracts`); the single source for validating LLM arguments **and** for the provider-facing JSON Schema. |
| `execute(params, ctx)` | Delegates to the same admin service that backs the manual route. |
| `preview(params, ctx)` | **Mutations only, required** — returns server-computed facts shown in the confirmable plan. |

### Rules enforced at registration

- `id` matches `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$` and is unique.
- `id` is prefixed with the owning `moduleId`.
- Every `mutation` implements `preview()`.

### Defense in depth

Tools are filtered twice — at interpretation time (`registry.visibleFor()`, by
module-install state + operator permission) and again at execution time in the
plan executor. A mutation is **inert** at interpretation time; it only runs after
the operator confirms the plan.

## Registered providers

| Module | File | Tools |
| --- | --- | --- |
| catalog | `packages/modules/catalog/src/backend/prompt-tools.ts` | `search_products`, `search_categories`, `assign_products_to_category`, `remove_products_from_category`, `set_product_status`, `set_products_visibility` |
| inventory | `packages/modules/inventory/src/backend/prompt-tools.ts` | `search_warehouses`, `set_stock_level` |
| orders | `packages/modules/orders/src/backend/prompt-tools.ts` | `search_orders`, `set_order_status`, `bulk_set_order_status` |
