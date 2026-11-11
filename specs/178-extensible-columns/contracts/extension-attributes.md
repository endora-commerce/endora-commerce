# Contract: Extension attributes on admin reads

## 1. Wire

- Query: `?extensions=<moduleId>[,<moduleId>…]` (≤ 8), `ExtensionsQuerySchema` in
  `packages/contracts/src/schema-extensions.ts`, merged into each host route's query schema.
- Response: each record gains `extensions?: Record<moduleId, Record<key, JsonValue>>` only when the
  parameter is present. Values: strings, numbers, booleans, null, ISO timestamps for `timestamptz`,
  decimal strings for `bigint`/`numeric`, JSON for `jsonb`.
- Without the parameter the response is byte-identical to today (contract test per host).

## 2. Platform service

Container name `schemaExtensionReads` (kernel-registered, like `effectiveState`):

```ts
interface SchemaExtensionReads {
  attach<T extends { id: string }>(
    em: EntityManager, host: ExtensibleHostTable, records: readonly T[], requested: readonly string[],
  ): Promise<ReadonlyMap<string, Record<string, Record<string, JsonValue>>>>;
}
```

For each requested module: skip unless a declaration `(module, host)` exists with `adminReads: true`
and `effectiveState.isPresent(module)`; then one `load(ids)`. Unknown, absent or non-exposed modules
are omitted silently (XVII: off behaves as never installed). The host route merges the map into
its serialised records.

## 3. Host routes (FR-051)

| Phase | Host | Detail | List |
| --- | --- | --- | --- |
| B | `organizations` | `GET /api/v1/admin/organizations/:id` | `GET /api/v1/admin/organizations` |
| D | `customer_accounts` | customer detail | customer list |
| D | `orders` | order detail | order list |
| D | `quote_requests` | quote detail | quote list |
| D | `products` | product detail | product list |
| D | `categories` | category detail | category tree/list |
| D | `crm_opportunities` | opportunity detail | opportunity list/board |
| D | `projects` | project detail | project list |
| D | `tasks` | task detail | task list |

Each route keeps its existing permission gate and reach rule; the attach runs on the records the
route already authorised. The developer resolving Phase D names the exact route files.

## 4. UI slot

The existing detail zones (`AdminZoneNameSchema`: organization, customer, order, quote request,
opportunity, task detail; product and category editor zones). A contribution reads through its own
route or through `?extensions=` on the host's detail route. `projects` has no detail zone; adding
one is out of scope.
