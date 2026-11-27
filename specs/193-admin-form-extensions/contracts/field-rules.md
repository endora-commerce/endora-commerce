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
    readonly on: HookableActionRef<any>;               // must offer 'beforeCommit'
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
  `changed` (for `writePermission`, OQ-193-4 A) — so `project` may instead return
  `{ after, changed: readonly string[] }`. One of `before` or `changed` is required on update.
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
A `derive` that targets a field is what clears `required-not-fillable`.

## §5 The field-rule check (platform, per writer)

Registered by `FormRegistry.seal` for every writer, as the first `beforeCommit` entry of that
action, exempt from 176's ordering. For a Command:

1. Skip entirely when no **present** module contributes a tightening, `requiredWhen`, format or
   `writePermission` to the set, and the owner declares no `writePermission` — the common case costs
   one map lookup.
2. Skip when the actor is a buyer self-service actor (OQ-193-3 A: `actorCustomerAccountId` set and no
   admin, or an anonymous storefront write).
3. `{ before|changed, after } = project(hookData)`.
4. For each field with an effective rule: evaluate `required` (create: on `after`; update: only if
   the field is in `changed` — OQ-193-4 A), bounds, `options`, `pattern`, `format` on `after` when
   the value is present; `requiredWhen` via `evaluateFieldCondition(cond, after)`.
5. `writePermission` for each field in `changed`: admin actor → `AdminPermissionChecker.hasPermission`;
   API-key actor → key `scopes` ([NEEDS CLARIFICATION, plan T-B6]); system actor → exempt.
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

The admin evaluates the same effective rules (from `GET /api/v1/admin/forms`) with the same
`evaluateFieldCondition` and the platform format twins before submit; a server `details[]` entry is
mapped onto the field by `path` (core key, or `extensions.<moduleId>.<key>` for a slot). A shared
vector table (`packages/contracts/src/admin-forms.vectors.ts`) is run by the contracts, platform and
admin-kit tests so the two ends cannot drift (SC-002).
