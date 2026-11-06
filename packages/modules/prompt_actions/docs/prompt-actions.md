---
title: Prompt actions (AI assistant)
description: Natural-language prompt mode for the admin command palette, with an explicit preview-and-confirm step before any change
---

# Prompt actions (AI assistant)

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
  dashboard's Recent activity card.

## Configuration (platform administrator)

Settings → group **Prompt actions (AI assistant)**:

| Setting | Default | Meaning |
|---------|---------|---------|
| `prompt_actions.activation` | `true` | The module switch. Off, the whole module is absent: the prompt API, the plan preview and execution path, and the tools other modules contribute to it. |
| `prompt_actions.enabled` | `false` | The assistant's own switch. When off, the module stays present and the palette behaves exactly as without it. |
| `prompt_actions.llm_credentials` | *(unset)* | Reference to an `llm` credential configuration created on the **Credentials** screen. That configuration is the single source of the provider, the model ID and the API key; the settings group holds no key of its own. |
| `prompt_actions.bulk_limit` | `500` | Maximum records one prompt may affect; larger plans are blocked at preview. |

To configure the assistant, create a credential configuration of type **LLM**
on the Credentials screen — provider `anthropic` (Claude), `google` (Gemini),
`openai` (GPT), `deepseek` (DeepSeek) or `openai_compatible` (any endpoint that
speaks the OpenAI chat-completions protocol, with its **Base URL**), a model ID
and the API key — then select it in `prompt_actions.llm_credentials` and switch
`prompt_actions.enabled` on. An OpenAI or DeepSeek configuration may also carry
a Base URL, which then replaces the provider's public endpoint (a proxy or
gateway); the Base URL is ignored for Anthropic and Google. The API key is a
write-only secret: encrypted at rest and never returned after saving. A
reference that resolves to no usable configuration — an unknown provider, an
OpenAI-compatible configuration without a valid Base URL — leaves the assistant
not configured.

**Ask the assistant…** is offered only while all three hold: the assistant is
enabled, the reference resolves to a supported provider with a model and a key,
and you hold the permission below. While one of them does not, the palette
shows no assistant row and no explanation.

Configuration changes apply without a restart and without reloading the admin
page: the backend reads the settings on every prompt, and the palette asks
whether the assistant is available each time it is opened. The backend needs
`SETTINGS_SECRET_ENCRYPTION_KEY` in its environment to store the API key (see
the root README, *Environment variables*).

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
automatically.

## v1 tool catalogue

| Tool | Kind | Permission |
|------|------|------------|
| `catalog.search_products` | resolver | `catalog:read` |
| `catalog.search_categories` | resolver | `catalog:read` |
| `inventory.search_warehouses` | resolver | `catalog:read` |
| `inventory.set_stock_level` | mutation | `catalog:write` |
| `catalog.assign_products_to_category` | mutation | `catalog:write` |
| `catalog.remove_products_from_category` | mutation | `catalog:write` |
| `catalog.set_product_status` | mutation | `catalog:write` |
| `catalog.set_products_visibility` | mutation | `catalog:write` |
| `catalog.archive_product` | mutation | `catalog:write` |
| `catalog.restore_product` | mutation | `catalog:write` |

Bulk category assignments above 50 products ride the existing durable
`catalog.bulk-operation` queue (the same worker that serves the bulk-edit
screen), so large prompts never block the API process.

**Archiving is not a status.** `catalog.set_product_status` switches products
on (`active`) or off (`inactive`) and never archives or restores them. Ask the
assistant to archive or restore instead: `catalog.archive_product` and
`catalog.restore_product` run the Catalog module's own Archive and Restore
actions — the same audit entry (`product.archive` / `product.restore`), with
the admin who confirmed the plan as the actor — and above 50 products they run
as the bulk Archive / Restore on the same queue, undoable from the bulk
operation's page. The plan's preview says that only Restore brings an archived
product back. `catalog.search_products` includes archived products and returns
`archived` beside `status`, so an archived product can be found to restore it.
The two tools are offered only where the Catalog module's command bus is wired.
