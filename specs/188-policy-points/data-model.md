# Data model: Declared policy points, and the organization moderation policy

Sections 1–4 are declarations and runtime shapes. Nothing in them is persisted by the platform.
Section 5 is the one new table, owned by `organizations`. Section 6 lists the new event, section 7
the audit states, and section 8 the translation keys.

## 1. Manifest additions (`packages/contracts/src/modules.ts`)

### 1.1 `policyPoints` — on the owner

`ModuleManifestSchema` gains this optional field. Its value is derived from the ref with
`toPolicyPointDeclaration(ref)`:

```text
policyPoints?: Array<{
  id:                 string   // ^[a-z][a-z0-9_]*\.[a-z][A-Za-z0-9]*$ — "<ownerModuleId>.<camelName>"
  combiner:           'chain' | 'commutative'
  budgetMs:           int      // 1..10000, default 500
  onFailure:          'refuse' | 'substitute'   // whether the ref declares onParticipantFailure
  defaultReasonCodes: string[] // ^[a-z][a-z0-9_]*$, unique; may be empty
}>
```

`defineModuleManifest` refuses three things:

- an id whose prefix before the first dot is not the manifest's own `id`;
- a duplicate id within one manifest;
- duplicate reason codes.

A duplicate id across two manifests is refused when the registry is sealed
(`DuplicatePolicyPointError`).

### 1.2 `policyContributions` — on the contributor

```text
policyContributions?: Array<{
  point:       string     // a policy point id
  id:          string     // ^[a-z0-9]+(-[a-z0-9]+)*$, unique per (module, point)
  reasonCodes: string[]   // ^[a-z][a-z0-9_]*$, unique; the closed set this participant emits
  overrides?:  boolean    // chain only: replaces rather than refines `previous` (research R-5)
  reason:      string     // 20..800 — what the participant decides, for a reviewer
}>
```

`defineModuleManifest` refuses three things:

- a duplicate `(point, id)`;
- a `point` whose owner prefix is the manifest's own id. An owner's participant is its default,
  declared in `policyPoints`.
- `overrides` on an entry whose point this manifest cannot see. That one is checked at seal
  instead, against the point's combiner (`OverrideOnCommutativePointError`).

The field coexists with `dependencies` on the point's owner. It is **not** a
`nonBindingDependencies` entry (research R-2).

### 1.3 `DeploymentDivergenceDeclarationSchema.policyOrder`

```text
policyOrder?: Record<pointId, moduleId[] (min 2)>   // .optional(), first runs first
```

It is read only for `chain` points, and only within one origin tier (research R-4). An entry for a
`commutative` point is refused at seal (`PolicyOrderOnCommutativePointError`), because it would
claim an order that has no effect. An entry naming modules of two tiers is refused
(`PolicyOrderContradictionError`), for the same reason.

### 1.4 `DeploymentDivergenceDeclarationSchema.policyParticipantGrants` (D-295 item 5)

```text
policyParticipantGrants?: Record<
  pointId,                         // POLICY_POINT_ID_RE
  Array<{                          // min 1; each moduleId at most once per point; .strict()
    moduleId:    string            // the granted package's module id (its `endora.id`)
    packageName: string            // its installed package.json `name`; must match the composed entry
    reason:      string            // 20..800, as omittedModules[].reason
  }>
>                                  // .optional(); absent means "no package takes part anywhere"
```

- **Shape** is refused by `parseDivergenceDeclaration` through the schema, naming the deployment's
  file. The schema's `.strict()` comment ("a fifth field is a typo") is rewritten to count the
  fields it now has.
- **Meaning** is refused by `PolicyRegistry.seal` as `InvalidPolicyParticipantGrantError(pointId,
  moduleId, cause)`, `cause` one of `unknown-point`, `unknown-module`, `not-a-package`,
  `package-name-mismatch` and `unused` (research R-12; 189 `contracts/module-origin.md` §5).
- **Effect.** A participation whose module's origin is `package` is accepted only when its
  `(point, moduleId)` is granted here. The grant is read by the seal and by the divergence
  derivation only. It never changes the module's origin (FR-025).
- `backend/src/apps/example/divergence.ts` writes both new fields out, empty, with the comment its
  doc block gives every field, and its "four things" list is corrected to the fields it has.

## 2. Divergence report additions (`packages/contracts/src/modules.ts`)

- `DivergenceKind` gains `'policy-participant'` and `'policy-participant-grant'`.
- `DivergenceDetail` gains:
  - `{ kind: 'policy-participant'; point: string; combiner: 'chain' | 'commutative'; participantId: string; position: number | null; override: 'declared' | null }`.
    `position` is `null` in the committed artefact (research R-13).
  - `{ kind: 'policy-participant-grant'; point: string; packageName: string }`.
- Keys: `policy-participant:<module>:<pointId>#<participantId>` and
  `policy-participant-grant:<moduleId>:<pointId>`.
- Rung: `3` for both.
- A grant entry's `reason` is the grant's inline reason, as an omission's is. It is never looked up
  in `reasons`, and a `reasons` key for it is the existing stale-reason finding.
- `DivergenceBoundary.notRecorded` gains `policyPoint`, with the reason "a module declaring its
  own decision point". `runtimeOnly` gains "chain position and observed overrides" and "a granted
  package's policy participants".

## 3. Contract types (`packages/contracts/src/policy-points.ts`, platform-free)

```text
PolicyCombiner           = 'chain' | 'commutative'
PolicyFailureKind        = 'threw' | 'timeout' | 'invalid-verdict' | 'write-attempt'
PolicyParticipantKey     = { moduleId: string; participantId: string }   // default: participantId 'default'
PolicyParticipantFailure = PolicyParticipantKey & { kind: PolicyFailureKind }
PolicyOutcome<V>         = PolicyParticipantKey & { verdict: V; substituted: boolean }
PolicyPointRef<I, V, D, C extends PolicyCombiner>   // see contracts/policy-points-api.md §1
```

The plan response (`PolicyPointPlanResponseSchema`) is in `contracts/admin-and-introspection.md`
§1.

## 4. Runtime shapes (`packages/platform/src/kernel/policies/`, not persisted)

```text
PolicyTraceEntry = PolicyParticipantKey & {
  origin:     ModuleOrigin         // 'core' | 'deployment' | 'package', from 189's contract
  outcome:    'decided' | 'skipped-absent' | 'failed'
  failure?:   PolicyFailureKind
  verdict?:   V                // decided, or the substitute for a failed participant
  durationMs: number
  readPrevious?: boolean       // chain only
}
PolicyEvaluation<D> = { decision: D; trace: readonly PolicyTraceEntry[] }
```

`PolicyRegistry` keeps per-process counters per participant: `evaluations` and `previousReads`.
`observedOverride` is derived from them (research R-5). The sealed plan holds, per participant, its
`origin` and `granted` (true only for a `package` participant admitted by a grant). The owner's
default participant has the owner's origin.

## 5. `organization_moderation_evaluations` — owned by `organizations`

This entity is `@OrgScoped()`, following the precedent of `organization_tax_id_validations`. It
has one row per evaluation that was **applied**: the Command found the organization still pending
at the version it noted (FR-039).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `organization_id` | uuid, not null, indexed, FK → `organizations.id` `on delete cascade` | the tenant anchor |
| `trigger` | varchar(32), not null | `registered` \| `registry_lookup_resolved` |
| `verdict` | varchar(16), not null | `approve` \| `hold` |
| `reasons` | jsonb, not null | `[{ moduleId, participantId, code, codeOwner }]`, sorted. `codeOwner` is the module whose bundle labels the code: the participant's own, or `organizations` for a substitute |
| `failed` | jsonb, not null, default `[]` | `[{ moduleId, participantId, kind }]` |
| `skipped` | jsonb, not null, default `[]` | `[{ moduleId, participantId }]`, the absent modules' participants |
| `input_digest` | jsonb, not null | codes only: `{ country, registryLookupOutcome, registryProvider, isPersonal }`. It shows what the rules saw, never tax ID, name or e-mail |
| `organization_version` | int, not null | the version the evaluation was applied at |
| `created_at` | timestamptz, not null, default now() | |

- **Index:** `(organization_id, created_at desc)` for "latest per organization". The queue reads
  it with one `DISTINCT ON (organization_id)` over the page's ids.
- **Retention:** rows are kept for the organization's lifetime. Organizations are soft-deleted, and
  the cascade covers a hard delete.
- **Migration:** one, in `packages/modules/organizations/src/migrations/`. It is scaffolded with
  `pnpm --filter backend run migration:new` after #1073 has merged. No number is assigned here.
- **Settings:** `organizations.moderation.mode` is unchanged (`manual` \| `auto`, default `manual`).
  Only its `settingLabels` text changes (FR-043). There is no data migration (FR-044).

## 6. Event `organization.tax_id_validation.resolved.v1`

```text
{ eventId: uuid, occurredAt: ISO, organizationId: uuid, outcome: 'validated' | 'failed' | 'unverified' }
```

It is emitted by `OrganizationTaxIdValidationService.trigger` after its flush, only when the
previous outcome was `deferred` and the organization is `pending_verification` (research R-16). It
carries ids and codes only, and it is added to `OrganizationEventBus`'s event map.

## 7. Audit state (`specs/conventions/audit-state.md`)

**`organization.moderation.record_evaluation`.** `objectType` is `organization`, `objectId` is the
organization id, and the actor is `system`, from the reactor's system scope. There is no
`automation` actor kind (D-293.6). The state is:

```text
before: null
after:  { evaluationId, trigger, verdict,
          reasonCodes: ['<moduleId>:<participantId>:<code>', …],      // sorted
          failedParticipants: ['<moduleId>:<participantId>:<kind>', …],
          skippedParticipants: ['<moduleId>:<participantId>', …] }
```

Every value is in list 1: an id, code-shaped values from declared closed sets, and module and
participant ids.

**The child `organization.approve`** is audited by that Command exactly as `specs/186-aggregate-ports/`
specifies: actor `system`, and `source: 'organizations.moderation'` in its state after, a code under
186's source grammar. `ORGANIZATIONS_AUDIT_KEYS` gains `evaluationId`, `trigger`,
`verdict`, `reasonCodes`, `failedParticipants` and `skippedParticipants`. The sentinel test of
`audit-state.md` §6 covers the new Command.

## 8. i18n keys

All keys are flat, in both `en.json` and `pl.json`.

| Bundle | Keys |
| --- | --- |
| `organizations` | `organizations.moderation.reason.mode_auto`, `.mode_manual`, `.default_unreadable`, `.participant_failed` |
| `organizations` | `moderation.policy.*` (queue column, detail panel headings, trigger labels, failure-kind labels, "No automatic evaluation") |
| `organizations` | `actions.openModerationQueue.{label,description,keywords}` |
| `organizations` | `settingLabels.organizations.moderation.mode.{name,description}` (rewritten text) |
| `_lifecycle` (platform) | `actions.openPolicyPoints.{label,description,keywords}` and the screen's labels |
| `_i18n` | `errors.POLICY_EVALUATION_FAILED` |
| each contributor | `<pointId>.reason.<code>` for every declared reason code |
