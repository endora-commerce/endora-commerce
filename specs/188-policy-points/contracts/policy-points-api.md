# Contract: the policy-point API (contracts, platform, test kit)

**Status**: proposed (WP-A). The names and shapes below are the surface that
`specs/191-membership-join-requests/` and instance overlay modules may depend on. Once WP-A merges,
changing any of them needs a changeset on the owning package: a minor while the package is in
`0.x`, with the old and new call in the changeset body (`specs/conventions/release-intent.md`).

## 1. `@endora-commerce/contracts` — `src/policy-points.ts` (platform-free)

```ts
export type PolicyCombiner = 'chain' | 'commutative';
export type PolicyFailureKind = 'threw' | 'timeout' | 'invalid-verdict' | 'write-attempt';

export interface PolicyParticipantKey { readonly moduleId: string; readonly participantId: string }
export interface PolicyParticipantFailure extends PolicyParticipantKey { readonly kind: PolicyFailureKind }
export interface PolicyOutcome<V> extends PolicyParticipantKey {
  readonly verdict: V;
  /** True when `verdict` is the point's substitute for a failed participant. */
  readonly substituted: boolean;
}

interface PolicyPointBase<I, V, D> {
  readonly id: string;                       // '<ownerModuleId>.<camelName>'
  readonly input: z.ZodType<I>;
  readonly verdict: z.ZodObject<any>;        // must be an object (research R-5); may carry `reasonCode`
  readonly decision: z.ZodType<D>;
  readonly budgetMs?: number;                // per participant; default 500, bounds 1..10000
  readonly defaultReasonCodes: readonly string[];
  /** Absent = fail-closed: evaluate() rejects with PolicyEvaluationError. */
  readonly onParticipantFailure?: (failure: PolicyParticipantFailure, previous: V | undefined) => V;
}
export interface ChainPolicyPoint<I, V> extends PolicyPointBase<I, V, V> { readonly combiner: 'chain' }
export interface CommutativePolicyPoint<I, V, D> extends PolicyPointBase<I, V, D> {
  readonly combiner: 'commutative';
  /** Must be order-independent. Receives outcomes sorted by (moduleId, participantId); default included. */
  readonly combine: (outcomes: readonly PolicyOutcome<V>[]) => D;
}
export type PolicyPointRef<I, V, D> = ChainPolicyPoint<I, V> | CommutativePolicyPoint<I, V, D>;

export function definePolicyPoint<I, V>(spec: Omit<ChainPolicyPoint<I, V>, 'decision'> & { decision?: never }): ChainPolicyPoint<I, V>;
export function definePolicyPoint<I, V, D>(spec: CommutativePolicyPoint<I, V, D>): CommutativePolicyPoint<I, V, D>;
// definePolicyPoint throws for: a malformed id, a budget out of bounds, duplicate or malformed
// defaultReasonCodes, or a non-object verdict schema. For chain, `decision` is set to `verdict`.

export const PolicyPointDeclarationSchema: z.ZodObject<{ id; combiner; budgetMs; onFailure; defaultReasonCodes }>;
export const PolicyContributionDeclarationSchema: z.ZodObject<{ point; id; reasonCodes; overrides; reason }>;
export function toPolicyPointDeclaration(ref: PolicyPointRef<unknown, unknown, unknown>): PolicyPointDeclaration;

export const POLICY_POINT_ID_RE = /^[a-z][a-z0-9_]*\.[a-z][A-Za-z0-9]*$/;
export const POLICY_PARTICIPANT_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const POLICY_REASON_CODE_RE = /^[a-z][a-z0-9_]*$/;
/** `<pointId>.reason.<code>`, looked up in the emitting module's bundle. */
export function policyReasonLabelKey(pointId: string, code: string): string;
```

- `ModuleManifestSchema` gains `policyPoints` and `policyContributions` (`data-model.md` §1).
- `DeploymentDivergenceDeclarationSchema` gains two optional fields (`data-model.md` §1.3, §1.4):

  ```ts
  export const PolicyParticipantGrantSchema = z.object({
    moduleId: z.string().regex(moduleIdRe),
    reason: z.string().min(20).max(800),
  }).strict();

  // inside DeploymentDivergenceDeclarationSchema, beside commandHookOrder:
  policyOrder: z.record(z.string().regex(POLICY_POINT_ID_RE), z.array(z.string().regex(moduleIdRe)).min(2)).optional(),
  policyParticipantGrants: z
    .record(z.string().regex(POLICY_POINT_ID_RE), z.array(PolicyParticipantGrantSchema).min(1))
    .superRefine(/* a moduleId at most once per point */)
    .optional(),
  ```

  Both are `.optional()` for the reason `commandHookOrder` is (176 amendment 2).
- `DivergenceKind` and `DivergenceDetail` gain `policy-participant` and `policy-participant-grant`
  (`data-model.md` §2).
- `ModuleOrigin` / `MODULE_ORIGINS` are **not** defined here. They are
  `specs/189-command-middleware/` `contracts/module-origin.md` §1's, and this contract imports them.
- `ERROR_CODES` gains `POLICY_EVALUATION_FAILED`. Its owner is `_i18n`, and it is translated under
  `errors.POLICY_EVALUATION_FAILED` in English and Polish.

## 2. `@endora-commerce/platform/kernel` — the seams and the runtime

```ts
// ModuleContext gains two members:
policyPoint<I, V, D>(
  ref: PolicyPointRef<I, V, D>,
  options: {
    /** Innermost for chain; one outcome among equals for commutative. */
    default: (input: Readonly<I>, ctx: PolicyParticipantContext) => V | Promise<V>;
    /** The owner's invariants over the final decision. Return a refusal message, or nothing. */
    validate?: (decision: D, input: Readonly<I>) => string | undefined;
  },
): PolicyEvaluator<I, D>;

policyParticipants(entries: readonly PolicyParticipantEntry[]): void;

type PolicyParticipantEntry =
  | { id: string; point: ChainPolicyPoint<infer I, infer V>;
      decide: (input: Readonly<I>, previous: Readonly<V>, ctx: PolicyParticipantContext) => V | Promise<V> }
  | { id: string; point: CommutativePolicyPoint<infer I, infer V, any>;
      decide: (input: Readonly<I>, ctx: PolicyParticipantContext) => V | Promise<V> };

export interface PolicyParticipantContext {
  readonly module: { readonly id: string };
  readonly participantId: string;
  readonly pointId: string;
  /** Aborted when the budget is spent. A participant calling out should pass it on. */
  readonly signal: AbortSignal;
  readonly log: PlatformLogger;
}

export interface PolicyEvaluator<I, D> {
  readonly pointId: string;
  /** Requires an ambient TenantContext. Throws PolicyEvaluationError when fail-closed. */
  evaluate(input: I): Promise<PolicyEvaluation<D>>;
}
export interface PolicyEvaluation<D> { readonly decision: D; readonly trace: readonly PolicyTraceEntry[] }

/** The participant currently deciding on this async path, else undefined. */
export function currentPolicyParticipant(): (PolicyParticipantKey & { readonly pointId: string }) | undefined;

// Runtime errors
export class PolicyEvaluationError extends HttpError {     // 500 POLICY_EVALUATION_FAILED
  readonly pointId: string;
  readonly cause: 'participant-failed' | 'decision-refused' | 'decision-invalid';
  readonly trace: readonly PolicyTraceEntry[];
}
export class PolicyParticipantWriteError extends Error {}   // CommandBus.run / EventBus.emit inside a participant

// Composition errors, raised when the registry is sealed, before boot hooks run.
// Each one names the modules, the participants and the point.
export class UndeclaredPolicyPointError extends Error {}          // registration for a point the owner did not declare in code
export class DuplicatePolicyPointError extends Error {}           // two modules declare one id, or ctx.policyPoint called twice
export class PolicyPointNotInManifestError extends Error {}       // ctx.policyPoint for an id missing from the module's policyPoints
export class UndeclaredPolicyParticipantError extends Error {}    // registered, not in policyContributions
export class UnregisteredPolicyParticipantError extends Error {}  // in policyContributions, never registered (owner composed)
export class DuplicatePolicyParticipantError extends Error {}
export class UnorderedPolicyParticipantsError extends Error {}    // chain: no path, no policyOrder entry
export class PolicyOrderContradictionError extends Error {}
export class PolicyOrderOnCommutativePointError extends Error {}
export class OverrideOnCommutativePointError extends Error {}
// D-295 item 5. Names the package, the point, `policyParticipantGrants` and the deployment's divergence.ts.
export class PackagePolicyParticipantNotGrantedError extends Error {}
export class InvalidPolicyParticipantGrantError extends Error {
  readonly pointId: string;
  readonly moduleId: string;
  readonly cause: 'unknown-point' | 'unknown-module' | 'not-a-package' | 'unused';
}
```

Registration resolves nothing. Calling either seam after the registry is sealed throws, as
`ctx.commandHooks` does.

## 3. `@endora-commerce/platform/composition` — for roots only

```ts
export class PolicyRegistry {
  constructor(options?: { isPresent?: (moduleId: string) => boolean; log?: PlatformLogger });
  seal(input: PolicyCompositionInput): void;
  plan(): PolicyPointPlanResponse;            // contracts/admin-and-introspection.md §1
}
export interface PolicyCompositionInput {
  readonly policyPoints: readonly (PolicyPointDeclaration & { moduleId: string })[];        // policyPointsFrom(manifests)
  readonly policyContributions: readonly (PolicyContributionDeclaration & { moduleId: string })[];
  readonly moduleDependencies: Readonly<Record<string, readonly string[]>>;                 // moduleDependencyClosureFrom
  readonly policyOrder?: Readonly<Record<string, readonly string[]>>;                       // from divergence.ts
  readonly policyParticipantGrants?: Readonly<Record<string, readonly { moduleId: string; reason: string }[]>>; // from divergence.ts
}
// The origin map is not part of the root's input: composeModules resolves it from the entries
// (189 `contracts/module-origin.md` §2) and passes it to seal() itself.
// seal(input: PolicyCompositionInput, origins: ReadonlyMap<string, ModuleOrigin>): void
export function policyPointsFrom(entries): …; export function policyContributionsFrom(entries): …;
export function orderByModuleDependencies<R extends { moduleId: string; seq: number }>(
  subject: string, registrations: readonly R[], closure: Readonly<Record<string, readonly string[]>>,
  tieBreak: readonly string[] | undefined, errors: { unordered(a, b): Error; contradiction(before, after): Error },
): R[];   // extracted from orderCommandHooks; hooks call it too
```

`composeModules` takes `policyRegistry` and `policies: PolicyCompositionInput`. These are the same
field names the context option uses, so `harness-parity.test.ts` holds both roots to them.
`backend/src/composition.ts` and `backend/test/test-server.ts` both wire the registry and pass
`policyOrder` and `policyParticipantGrants` from `loadDivergenceDeclaration()`, as they pass
`decorationOrder` and `commandHookOrder` today. The composer reads no file.

**Seal order of checks** (each one refuses before boot hooks run):

1. declarations against registrations (undeclared, unregistered, duplicates; FR-003);
2. drop the participations of points no composed module declares (FR-004);
3. **trust**: every `package`-origin participation needs a grant for its point
   (`PackagePolicyParticipantNotGrantedError`), then every grant must describe something
   (`InvalidPolicyParticipantGrantError`, four causes). A grant for a point the composition drops in
   step 2 is `unknown-point`: a dropped participation is silent, a stale grant is not;
4. ordering for `chain` points, per origin tier (§4 step 4);
5. combiner-specific refusals (`policyOrder` or `overrides` on a `commutative` point).

## 4. Run-time semantics (normative)

1. `evaluate(input)` asserts that a tenant context exists, parses `input` with `ref.input`, and
   deep-freezes it.
2. It takes the sealed participant list and drops each participant whose module is not `isPresent`.
   Each dropped one is traced `skipped-absent`. The default participant (the owner's) is never
   dropped.
3. Each participant runs inside the participant frame, raced against `budgetMs` with an
   `AbortSignal`. A verdict is valid when it passes `ref.verdict` and, where it carries
   `reasonCode`, that code is in the participant's declared codes (`defaultReasonCodes` for the
   default and for substitutes).
4. **For `chain`.** The default runs first with no `previous`. Then each contributed participant
   runs in sealed order with `(input, previousProxy)`. The decision is the last verdict. The sealed
   order is: the `core` tier, then the `package` tier, then the `deployment` tier; within a tier,
   `orderByModuleDependencies` with `policyOrder[pointId]` as the tie-break (research R-4, R-25).
5. **For `commutative`.** All participants run concurrently, whatever their origin. The outcomes are
   sorted by `(moduleId, participantId)`, and `ref.combine(outcomes)` gives the decision.
   `PolicyOutcome` carries no origin (research R-25).
6. **On a failure.** If the point declares `onParticipantFailure`, its verdict replaces the failed
   one and is validated as in step 3. The trace entry is marked `failed` with `failure`. Without a
   substitute, the evaluation rejects with `PolicyEvaluationError('participant-failed')` after
   every participant has settled.
7. **The decision** is parsed with `ref.decision`. A failure gives `PolicyEvaluationError('decision-invalid')`.
   Then the owner's `validate` runs. A message from it gives `PolicyEvaluationError('decision-refused')`.
8. **Writes.** Nothing is written by the platform. Inside a frame, `CommandBus.run` and
   `EventBus.emit` throw `PolicyParticipantWriteError`. The participant then counts as failed with
   kind `write-attempt`.
9. **Override tracking.** For `chain`, a participant that is undeclared as an override and returned
   without reading `previousProxy` increments its counters. The first observation logs
   `kernel.policy-override` with the module, the participant and the point.

## 5. `@endora-commerce/test-kit/policies`

```ts
/** Evaluate a point with no composition: the owner's real ref, a supplied default, and participants. */
export function evaluatePolicyPointForTest<I, V, D>(
  ref: PolicyPointRef<I, V, D>,
  setup: { default: (input: I) => V | Promise<V>; participants?: readonly TestParticipant<I, V>[];
           isPresent?: (moduleId: string) => boolean; validate?: (d: D, i: I) => string | undefined },
  input: I,
): Promise<PolicyEvaluation<D>>;

export interface TestParticipant<I, V> {
  readonly moduleId: string;
  readonly declaration: PolicyContributionDeclaration;   // the manifest entry itself
  readonly decide: PolicyParticipantEntry['decide'];
}

/**
 * Runs every case with and without `participant`, against each supplied default verdict.
 * It fails on: an invalid decision, a budget overrun, a write attempt, an undeclared reason
 * code, an undeclared override (chain: decision unchanged under two different `previous`),
 * and, with `bundles`, a missing en/pl label for any declared reason code.
 * It returns both decisions per case for the author's own assertions.
 */
export function expectPolicyParticipantConformance<I, V, D>(
  ref: PolicyPointRef<I, V, D>,
  participant: TestParticipant<I, V>,
  cases: readonly { name: string; input: I; defaultVerdicts: readonly V[]; previous?: readonly V[] }[],
  options?: { bundles?: { en: Record<string, string>; pl: Record<string, string> } },
): Promise<ReadonlyArray<{ name: string; without: D; with: D }>>;

/** Owners: every permutation (≤ 6 outcomes) or 50 seeded shuffles give one decision. */
export function expectCommutativeCombine<I, V, D>(
  ref: CommutativePolicyPoint<I, V, D>, samples: readonly (readonly PolicyOutcome<V>[])[],
): void;

/** A sealed registry for a module's unit test, like sealedCommandHookRegistry. */
export function sealedPolicyRegistry(input: Partial<PolicyCompositionInput>): PolicyRegistry;
```

## 6. Rules for owners

- Declare a point only for a decision whose effects your own Command applies. Never apply a
  decision anywhere else.
- Publish the ref in `@endora-commerce/contracts`, list it in `policyPoints`, and give a
  `default`. Translate every `defaultReasonCodes` entry under `<pointId>.reason.<code>`.
- A `commutative` owner tests its `combine` with `expectCommutativeCombine`.
- The id, the combiner, the schemas, the combine function and the failure treatment are public.
  Changing one needs a changeset.

## 7. Rules for contributors

- Declare every participant in `policyContributions`, with its reason codes. Register it with
  `ctx.policyParticipants`.
- Decide from the input and your own module's data. Do not write, do not emit, and constrain any
  tenant-scoped read by the input's organization id.
- Pass `ctx.signal` to anything that calls out, and stay inside the budget.
- Ship `expectPolicyParticipantConformance` tests with your bundles.
- An installed third-party package (origin `package`) takes part only in a point the deployment
  grants it, in its `divergence.ts` `policyParticipantGrants`. Without the grant the composition
  refuses and names the field. The grant admits the package to that point and to nothing else: its
  origin stays `package`, it still cannot decorate, and it is still `observe`-only for command
  middleware. A package author documents which grant the package needs; the deployment decides.

## 8. Example (an overlay module)

```ts
// manifest.ts
policyContributions: [{
  point: 'organizations.moderation', id: 'registry-confirmed', reasonCodes: ['registry_confirmed', 'registry_not_confirmed'],
  reason: 'Holds a new business whose tax ID the public registry did not confirm, so a person checks it.',
}],

// backend.ts
import { ORGANIZATION_POLICY_POINTS as P } from '@endora-commerce/contracts';
export function registerModule(ctx: ModuleContext): void {
  ctx.policyParticipants([{
    id: 'registry-confirmed',
    point: P.moderation,
    decide: (input) =>
      input.registryLookup.outcome === 'validated'
        ? { verdict: 'approve', reasonCode: 'registry_confirmed' }
        : { verdict: 'hold', reasonCode: 'registry_not_confirmed' },
  }]);
}
```

## 9. Example (a grant for a third-party package)

```ts
// backend/src/apps/<deployment>/divergence.ts
export const divergence: DeploymentDivergenceDeclaration = {
  omittedModules: [],
  decorationOrder: {},
  commandHookOrder: {},
  policyOrder: {},
  policyParticipantGrants: {
    'organizations.moderation': [{
      moduleId: 'acme_credit_check',
      reason:
        'Holds a new business whose credit score from the bureau this shop contracts is below the ' +
        'threshold agreed with finance, so a person reviews it before it can order on terms.',
    }],
  },
  reasons: {},
};
```

The divergence report then carries
`policy-participant-grant:acme_credit_check:organizations.moderation` with that reason, at rung 3.
