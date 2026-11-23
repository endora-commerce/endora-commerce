# Contract: the entity-extension declaration (FR-001 – FR-005)

## 1. Manifest field

`packages/contracts/src/modules.ts`, on `ModuleManifestSchema`:

```ts
/** `specs/187-side-table-extensions/` — one entry per side table this module owns on an extensible host. */
export const EntityExtensionDeclarationSchema = z
  .object({
    /** `<ownerModuleId>.<EntityClassName>` of an extensible host, e.g. `organizations.Organization`. */
    entity: z.string().regex(/^_?[a-z][a-z0-9_]*\.[A-Z][A-Za-z0-9]*$/),
    /** The declaring module's own table: lower-case identifier, ≤ 63 bytes. */
    table: z.string().regex(/^[a-z][a-z0-9_]*$/).max(63),
  })
  .strict();
export type EntityExtensionDeclaration = z.infer<typeof EntityExtensionDeclarationSchema>;

// on ModuleManifestSchema:
  /**
   * Side tables this module owns on extensible hosts (data ladder D1). Declaring
   * creates no lifecycle edge of its own: the host's owner must already be in
   * `dependencies` (FR-004), which is what orders the migrations.
   */
  extends: z.array(EntityExtensionDeclarationSchema).max(16).optional(),
```

`defineModuleManifest` refuses a `table` that appears twice in one manifest (`duplicate-table`).
Absent means "this module extends no host", which is true of most modules and is not a finding.

## 2. Binding registry change (FR-003)

`CustomFieldHostBinding` gains `entityClassName: string`:

| Binding key | `table` | `ownerModuleId` | `entityClassName` |
| --- | --- | --- | --- |
| `organization` | `organizations` | `organizations` | `Organization` |
| `customer` | `customer_accounts` | `customer_accounts` | `CustomerAccount` |
| `order` | `orders` | `orders` | `Order` |
| `quote_request` | `quote_requests` | `quote_requests` | `QuoteRequest` |
| `product` | `products` | `catalog` | `Product` |
| `category` | `categories` | `catalog` | `Category` |
| `opportunity` | `crm_opportunities` | `crm` | `CrmOpportunity` |
| `project` | `projects` | `projects` | `Project` |
| `task` | `tasks` | `tasks` | `Task` |

The class names were read from the entity files named in `spec.md` § Context (`export class …`,
verified on `ff7efc3e8`). Metadata rule **M0** (`verification-rules.md` §2) holds them at every ORM
initialisation: the entity mapping a binding's `table` must carry `entityClassName`, else
`host-binding-mismatch`. If they disagree, the entity wins and the binding is the defect. The
existing FR-012 reconciliation in `check:extensible-tables` is left as it is (table and owner), so no
check script's obligations move.

`packages/platform/src/kernel/schema-extensions/extensible-hosts.ts` gains

```ts
export interface ExtensibleHost { readonly table: string; readonly ownerModuleId: string; readonly entityClassName: string }
/** `organizations.Organization` → host. Every binding; no rollout constant (research R-3). */
export const ENTITY_EXTENSION_HOSTS: ReadonlyMap<string, ExtensibleHost>;
```

## 3. Static rules (no ORM, no database)

Run by `defineModuleManifest` (E1, E5) and by the manifest-registry derivation over the whole
composition (E2 – E4), so the lifecycle, boot, `migrate` and `audit-packages` all apply them.

| Rule | Refused when | Error `rule` |
| --- | --- | --- |
| E1 | the entry fails `EntityExtensionDeclarationSchema` | `declaration-shape` |
| E2 | `entity` is not a key of `ENTITY_EXTENSION_HOSTS` | `host-not-extensible` (message lists the nine) |
| E3 | the host's `ownerModuleId` is not in the declaring module's dependency closure | `host-not-a-dependency` |
| E4 | the declaring module **is** the host's owner | `self-extension` (a module owns its own columns; it needs no side table on itself to be declared) |
| E5 | one manifest names a `table` twice | `duplicate-table` |

E4 is an architect addition: a host module keeping a 1:1 table of its own is ordinary ownership,
not an extension, and declaring it would make the host appear as its own dependent.

All rules throw `EntityExtensionInvalidError` (`packages/platform/src/kernel/entity-extensions/errors.ts`)
carrying `{ rule, moduleId, origin, table, entity, detail }`. The message names the module, its
origin, the table and the remedy.

## 4. Origin

`origin` (`core` | `package` | `overlay`, from `RegisteredManifestEntry`) is carried into errors and
list rows and read by **no** rule (FR-005, OR-5). A unit test builds the same declaration under each
origin and asserts identical verdicts.
