# Prompt Actions (AI assistant)

The `prompt_actions` module adds a natural-language prompt mode to the admin
command palette (`⌘K` / `Ctrl+K`). An operator describes what they want in
plain language — Polish or English — and the platform interprets the
instruction, shows exactly what it is about to change, and executes it only
after explicit confirmation.

Example prompts:

- *Dla produktu „Bolts 0193" zwiększ stan magazynowy w magazynie „Default" na 120 sztuk*
- *Assign every product with "Helmets" in its name to the "Helmets" category*

## How it works (operator view)

1. Open the palette and pick **Ask the assistant…** (visible only when the
   feature is enabled, configured, and you hold the *Use the prompt
   assistant* permission).
2. Type the instruction and submit. The assistant resolves names ("Bolts
   0193", "Default") into concrete records using read-only searches.
3. A **plan card** appears: the exact operation(s), the current value, the
   number of affected records and a sample for bulk changes. Nothing has
   been changed yet.
4. **Confirm** to execute, or **Cancel** to keep everything untouched. Plans
   expire after 10 minutes without confirmation.
5. The result reports per-item outcomes. Bulk runs above 50 records continue
   in the background; if you close the palette, a notice appears on the next
   open until you view the result.

If the instruction is ambiguous the assistant asks one clarifying question
(with concrete candidates) instead of guessing. Unsupported requests and
missing permissions are reported plainly, and nothing changes.

## Security model

- The model can only call a **curated tool catalogue** registered in code —
  it cannot run SQL, call arbitrary endpoints, or invent operations. Tools
  the operator has no permission for are not even shown to the model.
- Mutations are **never executed during interpretation**: they are captured
  into a plan; each plan operation re-checks the operator's live permission
  at execution time.
- Everything on the plan card is **server-computed** (names, counts, current
  values). Model prose is never displayed, and tool results are treated
  strictly as data — a product named like an instruction cannot change the
  assistant's behavior.
- Every execution writes audit entries: a `prompt_action.execute` summary
  (with the original prompt, provider and model) plus the underlying
  modules' own audit rows (e.g. `stock_level.adjust`). Permission refusals
  are audited as `prompt_action.refused`. Executions also appear on the
  dashboard's Recent Activity card.

## Configuration (platform administrator)

Settings → group **Prompt actions (AI assistant)**:

| Setting | Default | Meaning |
|---------|---------|---------|
| `prompt_actions.enabled` | `false` | Platform-wide kill switch. When off, the palette behaves exactly as without the module. |
| `prompt_actions.provider` | `anthropic` | LLM provider: `anthropic` (Claude), `google` (Gemini) or `openai` (GPT). |
| `prompt_actions.model` | `claude-sonnet-4-6` | Model ID for the chosen provider. |
| `prompt_actions.api_key` | *(unset)* | Provider credential. **Write-only secret**: encrypted at rest, never returned by the settings API after saving. |
| `prompt_actions.bulk_limit` | `500` | Maximum records one prompt may affect; larger plans are blocked at preview. |

Configuration changes apply on the next prompt — no restart. The backend
needs `SETTINGS_SECRET_ENCRYPTION_KEY` in its environment to store the API
key (see the root README, *Environment variables*).

Grant operators the **Use the prompt assistant** (`prompt_actions:use`)
permission on the Roles screen. Each planned operation additionally requires
the same permission as the equivalent manual action (e.g. `catalog:write`
for a stock change), so the assistant can never exceed what the operator
could do by hand.

## Extending the catalogue (module authors)

Modules contribute tools at composition time through the
`PromptActionToolRegistry` port — the same adapter-registry pattern used by
payment and shipping providers. A tool declares:

```ts
{
  id: '<moduleId>.<snake_case_name>',   // e.g. 'inventory.set_stock_level'
  moduleId: 'inventory',
  kind: 'resolver' | 'mutation',
  description: '…',                      // English; the LLM's only documentation
  requiredPermission: 'catalog:write',   // MUST mirror the manual route's permission
  paramsSchema: zodSchema,               // validates LLM args + becomes the JSON Schema
  execute(params, ctx) { … },            // resolvers run during interpretation;
                                         // mutations only at confirm time
  preview(params, ctx) { … },            // mutations only — server-computed facts
}
```

Rules (enforced at registration where possible): dotted ids prefixed with
the owning module; resolvers are side-effect-free and cap results (≤ 20);
mutations must implement `preview()` returning honest, server-computed
counts and samples; tools of disabled modules disappear from the catalogue
automatically. See
`specs/043-admin-prompt-actions/contracts/prompt-actions-api.md` for the
full contribution contract and the HTTP API.

## v1 tool catalogue

| Tool | Kind | Permission |
|------|------|------------|
| `catalog.search_products` | resolver | `catalog:read` |
| `catalog.search_categories` | resolver | `catalog:read` |
| `inventory.search_warehouses` | resolver | `catalog:read` |
| `inventory.set_stock_level` | mutation | `catalog:write` |
| `catalog.assign_products_to_category` | mutation | `catalog:write` |

Bulk category assignments above 50 products ride the existing durable
`catalog.bulk-operation` queue (the same worker that serves the bulk-edit
screen), so large prompts never block the API process.
