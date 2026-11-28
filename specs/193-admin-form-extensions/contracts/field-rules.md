# Contract: field rules, behaviour and server enforcement (FR-022, FR-040 – FR-045, FR-060 – FR-062, R-9, R-11, R-12)

## §1 Tightening vocabulary

```ts
export const FieldValidationTighteningSchema = z.object({
  required: z.literal(true).optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().max(256).optional(),      // ECMAScript source, compiled with 'u'
  options: z.array(z.string()).min(1).optional(),
  format: z.string().optional(),                // usually implied by a control
  /** Per-rule message key in the declaring module's bundle; default: the platform sentence. */
  messageKey: translationKey.optional(),
}).strict();
```

Admitted only as a narrowing of the core declaration (`override-loosens-rule` otherwise):
`minLength ≥ core.minLength`, `maxLength ≤ core.maxLength`, likewise `min`/`max`; `options ⊆
core.options` (enum) or any non-empty list (string — then the value must be one of them);
`required` only on a core-optional field; `pattern` on `string` / `string[]` only. Several modules'
tightenings on one field merge by conjunction (max of mins, min of maxes, intersection of options,
all patterns, all formats).

## §2 Writers and the projection (owner side)

```ts
// @endora-commerce/platform/kernel — ModuleContext gains:
fieldSets(entries: readonly {
  readonly set: FieldSetDeclaration;
  readonly writers: readonly {
    readonly on: HookableActionRef<any>;               // must offer 'beforeCommit', unless ruleCheckOnly
    /** FR-113: a Command that is not a declared hookable action, reversible or not (D-300.27). Admits only the field-rule check; needs hookData. */
    readonly ruleCheckOnly?: boolean;
    /** FR-124: scoped writer — `project` returns one entry per saved scope. */
    readonly scoped?: boolean;
    readonly mode: 'create' | 'update';
    /** Pure: hook data → field values. `before` null on create. Keys outside the set are ignored. */
    readonly project: (data: unknown) => {
      readonly before: Readonly<Record<string, unknown>> | null;
      readonly after: Readonly<Record<string, unknown>>;
    };
    /** Keys this writer can change; a field missing from every writer's list is not writable here. */
    readonly writes: readonly string[];
  }[];
}[]): void;
```

- Only the field set's owner may register it (`foreign-field-set-registration`).
- A field is **projected** when every writer listing it in `writes` returns it in `after` (and
  `before` on update). `accepts-unenforceable` (form-field-declaration §3) is decided from `writes`.
- Where hook data carries no `before` (e.g. `OrganizationUpdateHookData` has the after-state and
  `changedFields`), the projection derives `before` only for what it needs: the platform needs
  `changed` (for `writePermission`, D-300.4) — so `project` may instead return
  `{ after, changed: readonly string[] }`. One of `before` or `changed` is required on update.
- **A write that is not a writer** is not held to any rule. That is right only where the write
  cannot create a violation of its own: fixed system values written outside the Command Bus, or
  values copied from records that already store them. `organization.merge.finalize` is the case in
  `organizations` (D-300.28). Its own grant is the authority for the fields it copies, so
  `writePermission` does not bind a merge. A deployment that protects a field with
  `writePermission` should restrict the merge grant to match.
- Test helpers (`@endora-commerce/test-kit`): `expectFieldSetMatchesSchemas(set, { create, update })`
  and `expectFieldSetWriters(set, commandsByAction)` — the latter runs each writer's Command in a
  fixture and asserts the projection covers `writes`.

## §3 Conditions

```ts
export type FieldCondition =
  | { field: string; op: 'equals' | 'notEquals'; value: string | number | boolean | null }
  | { field: string; op: 'in'; value: readonly (string | number)[] }
  | { field: string; op: 'isEmpty' | 'isNotEmpty' }
  | { all: readonly FieldCondition[] } | { any: readonly FieldCondition[] } | { not: FieldCondition };
export const FieldConditionSchema: z.ZodType<FieldCondition>;  // depth ≤ 4, leaves ≤ 16
export function evaluateFieldCondition(c: FieldCondition, values: Readonly<Record<string, unknown>>): boolean;
```

`isEmpty`: `undefined`, `null`, `''` after trim, `[]`. `field` names a core key of the same set, or —
on a slot's own `visibleWhen` / in the declaring module's own override — `<ownModuleId>.<key>`.
Anything else: `condition-foreign-field`.

## §4 Behaviour (admin layer, UI-only)

```ts
// AdminContributions.fieldBehaviours
export interface AdminFieldBehaviour {
  readonly target: string;                // '<fieldSet>.<key>' or '<fieldSet>.<ownModuleId>.<key>'
  readonly forms?: readonly string[];
  /** Default export: { mask?: (raw: string) => string; derive?: { from: readonly string[]; compute: (values) => unknown } } */
  readonly behaviour: AdminComponentFactory;
}
```

Requires `behaviour` in the target's `accepts` (own slot fields always accept it). `derive` writes
the target only while the operator has not edited it in this form session; the server never runs it.
On an edit form it writes the target only while at least one of its `from` fields differs from its
loaded value. When none does, and the operator has not edited the target, the target returns to its
loaded value. Opening a record therefore never rewrites a stored value, and a round trip of a `from`
field leaves the target as stored (D-300.20).
A `derive` that targets a field is what clears `check:admin-forms`' `required-not-fillable` for a
read-only field (D-300.12). The check cannot tell a `derive` from a `mask`, because both are behind
the lazy factory, so it accepts any `fieldBehaviours` entry of the module that sets `readOnly`,
targeting the field on that form. A mask on a read-only field does nothing, so in practice the entry
is a derivation. A derived read-only field is submitted (field-slots.md §3).

## §5 The field-rule check (platform, per writer)

Registered by `FormRegistry.seal` for every writer, as the first `beforeCommit` entry of that
action, exempt from 176's ordering; for a `ruleCheckOnly` writer the bus runs it at the same
position (after `run`, before commit) although the action admits no module hook. For a scoped
writer, steps 3–4 run per projected scope, and `required` is evaluated for the global scope only
(FR-124). For a Command:

1. Skip entirely when no **present** module contributes a tightening, `requiredWhen`, format or
   `writePermission` to the set, and the owner declares no `writePermission` — the common case costs
   one map lookup.
2. Skip when the write is buyer self-service (D-300.3, D-300.10): the actor is `kind: 'customer'`
   with `actorAdminUserId === null`, **or** the check context's `buyerSelfService` is true and the
   actor has `actorAdminUserId === null` and kind `system` or `customer`. The bus sets
   `buyerSelfService` when this Command or any ancestor in its lineage declares
   `Command.buyerSelfService: true`. On an `admin` or `api_key` actor the flag is ignored. A
   `system` actor without it is bound (fail closed): a worker, an import and an integration callback
   look the same from here.
3. `{ before|changed, after } = project(hookData)`.
4. For each field with an effective rule, decide whether this write **holds** it (D-300.4,
   D-300.11). A create holds every field. An update holds a field when the field is in `changed`
   (set or cleared). For `requiredWhen` only, an update also holds the field when `changed` contains
   any field the condition reads (the leaves' `field`s). A held field is checked: `required` (or a
   true `requiredWhen`, via `evaluateFieldCondition(cond, after)`) on `after`; and bounds,
   `options`, `pattern` and `format` on `after` when the value is present. A field that is not held
   is not checked at all, so a record stored before a rule existed stays editable in its other
   fields.
5. `writePermission` for each field in `changed`: admin actor → `AdminPermissionChecker.hasPermission`;
   bound API-key actor → refused, `reason: 'api-key-scopes-unresolved'` (T-B6, research R-12: no scope
   resolution exists in a Command); system actor, an unbound key included → exempt.
6. Collect all violations; throw `HttpError(422, 'FIELD_RULE_VIOLATION', …, { details })` or
   `HttpError(403, 'FIELD_WRITE_FORBIDDEN', …, { details })` (403 wins when both). The transaction
   rolls back; no audit entry, no outbox row.

```ts
details: [{ path: 'emails', code: 'required' | 'too_short' | 'too_long' | 'below_min' | 'above_max'
          | 'not_an_option' | 'pattern' | 'format', params?: { limit?: number; format?: string },
          message: string /* request language; messageKey if declared */ }]
```

`FIELD_RULE_CODES` is that `code` union (additive-only). Error codes `FIELD_RULE_VIOLATION`,
`FIELD_WRITE_FORBIDDEN`, `FIELD_SLOT_INPUT_INVALID` are declared by `_lifecycle`, translated under
`errors.<CODE>` (pl + en); the per-code sentences under `fieldRules.<code>` in `_lifecycle`'s
bundle.

## §6 Client parity

The admin evaluates the same effective rules (from `GET /api/v1/admin/effective-forms`) with the
same `evaluateFieldCondition` and the platform format twins before submit, over the same held set as
§5 step 4. "The same effective rules" means what §5 checks: the merged tightenings, `requiredWhen`,
platform formats and the integer format that `platform.integer` implies. A module format is left to
the server. The core declaration's `required` and bounds stay the host's own validation, as they
were before it adopted; the kit shows the core `required` marker but does not check it (D-300.19).
The held set: on an edit form, a field the operator has not changed, and whose `requiredWhen` inputs
are unchanged, is not checked (D-300.11); a server `details[]` entry is
mapped onto the field by `path` (core key, or `extensions.<moduleId>.<key>` for a slot). A shared
vector table (`packages/contracts/src/admin-forms.vectors.ts`) is run by the contracts, platform and
admin-kit tests so the two ends cannot drift (SC-002).
