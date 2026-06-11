# Per-module AI-assistant command registration (feature 043)

The admin AI assistant (`prompt_actions`) executes **tools** — the only catalogue
of operations the interpreter may draw from. Any module can contribute its own
tools so its admin actions become assistant-invokable, **without `prompt_actions`
ever importing the module's internals** (adapter-registry pattern, Constitution
Principle I — mirrors the payment/shipping adapter registries).

## How a module registers its commands

1. **Add `backend/src/modules/<module>/prompt-tools.ts`** exporting a provider
   function that returns a flat `PromptActionTool[]`:

   ```ts
   export function <module>PromptTools(deps): PromptActionTool[] {
     // construct the module's own services from deps.emFactory etc.
     return [ /* resolvers + mutations */ ];
   }
   ```

2. **Register it in `composition.ts`** — append the provider to the
   `promptActionToolProviders` array (one line). The shared
   `PromptActionToolRegistry.register()` validates each tool on insertion.

## The `PromptActionTool` contract

(`prompt_actions/services/tool-registry.ts`)

| Field | Rule |
| --- | --- |
| `id` | `'<moduleId>.<snake_case_name>'`, globally unique. |
| `moduleId` | Must equal the `id` prefix; gates visibility on module install state. |
| `kind` | `'resolver'` (side-effect-free, runs during interpretation) or `'mutation'`. |
| `description` | English, action-oriented — the LLM's **only** documentation. |
| `requiredPermission` | Mirror the permission guarding the equivalent manual admin route. |
| `paramsSchema` | A Zod schema (lives in `@b2b/contracts`); the single source for validating LLM arguments **and** for the provider-facing JSON Schema. |
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
| catalog | `catalog/prompt-tools.ts` | `search_products`, `search_categories`, `assign_products_to_category`, `set_product_status`, `set_products_visibility` |
| inventory | `inventory/prompt-tools.ts` | `search_warehouses`, `set_stock_level` |
| orders | `orders/prompt-tools.ts` | `search_orders`, `set_order_status`, `bulk_set_order_status` |
