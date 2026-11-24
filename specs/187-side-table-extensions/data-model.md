# Data model: Side-table entity extensions

This feature adds **no table, no column and no migration** to the platform or to any host. Its data
is declarations (manifest), registrations (process memory) and catalog facts (read on demand). The
one schema change in the tree is the declaring modules' own — `quote_requests` already has its two
tables; it gains manifest lines only.

## 1. Entity-extension declaration (manifest)

| Field | Type | Rule |
| --- | --- | --- |
| `entity` | `'<ownerModuleId>.<EntityClassName>'` | a key of `ENTITY_EXTENSION_HOSTS` (E2); owner in the dependency closure (E3); not the declaring module (E4) |
| `table` | SQL identifier ≤ 63 bytes | unique per manifest (E5); mapped by an entity of the declaring module (M1, M2) |

Contract: `contracts/entity-extension-declaration.md`.

## 2. Extensible host (derived)

`ExtensibleHost { table, ownerModuleId, entityClassName }`, one per `CUSTOM_FIELD_HOST_BINDINGS`
entry. `entityClassName` is the new binding field (FR-003). Nine hosts; their classifications decide
the admitted side classifications (`contracts/verification-rules.md` §3).

## 3. Side table (owned by the declaring module)

Physical shape the platform verifies; everything else is the module's.

```sql
create table "<table>" (
  "<host_key>" uuid not null,
  -- … the module's own columns …
  constraint "<table>_pkey" primary key ("<host_key>"),
  constraint "<table>_<host>_fk" foreign key ("<host_key>")
    references "<host_table>" ("id") on delete cascade
);
```

| Property | Rule |
| --- | --- |
| primary key | exactly one column (P2/M3), type `uuid` (M4) |
| foreign key | its columns equal the primary key's, references the host table's primary key (P3), `on delete cascade` (P4) |
| entity | one entity of the declaring module maps it (M1, M2) |
| classification | admitted for the host (M5) |
| other columns, indexes, constraints | the module's; unconstrained by this feature (a unique index on an ERP key is the module's choice) |
| constraint names | the module's; the guide recommends `<table>_pkey` and `<table>_<host-singular>_fk` |

State: none the platform keeps. The table lives and dies with its module's migrations: created by
`up()`, dropped by `down()` on `uninstall --hard`; host rows' deletion cascades.

## 4. Extension loader (registration, process memory)

| Field | Type | Rule |
| --- | --- | --- |
| `moduleId` | attributed by the context | — |
| `host` | `'<ownerModuleId>.<EntityClassName>'` | declared in the module's `extends` (L1) |
| `schema` | Zod schema of `T` | values parsed against it (FR-057) |
| `load` | `(ids, { em }) => Promise<ReadonlyMap<string, T>>` | one call per read; unique per (module, host) (L2) |

## 5. Extension attribute (on a read-port record)

`record.extensions?: Readonly<Record<moduleId, T | null>>`.

| State | `extensions` | `extensions[moduleId]` |
| --- | --- | --- |
| no `include` | absent | — |
| included, module present, side row exists | present | `T` |
| included, module present, no side row | present | `null` |
| included, module not effectively present | present only if another included module is present | absent |
| included, no loader in the composition | the call fails `422 ENTITY_EXTENSION_UNCLAIMED` | — |

## 6. Verification finding (transient)

`{ rule, moduleId | null, origin | null, table, host, detail }` — thrown in
`EntityExtensionInvalidError` (static, metadata, registration) or `EntityExtensionDriftError`
(physical), or logged at `warn` (`unowned`, `undeclared` under policy `warn`). Rules:
`declaration-shape`, `host-binding-mismatch`, `host-not-extensible`, `host-not-a-dependency`, `self-extension`,
`duplicate-table`, `table-not-owned`, `primary-key-not-single`, `primary-key-type-mismatch`,
`tenancy-mismatch`, `host-scope-not-offered`, `table-missing`, `foreign-key-missing`,
`foreign-key-not-cascade`, `undeclared-entity-extension`, `unowned-entity-extension`,
`loader-without-extension`, `duplicate-loader`, `registration-after-seal`.

## 7. List row (transient)

`contracts/schema-extensions-cli.md` §1: `{ kind: 'entity-extension', moduleId, origin, host,
hostTable, table, constraint, status }`.
