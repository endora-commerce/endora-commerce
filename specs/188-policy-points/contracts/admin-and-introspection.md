# Contract: plan API, platform screen, divergence entry, and `module:status`

**Status**: proposed (WP-A).

## 1. `GET /api/v1/admin/policy-points`

The route is registered by `_lifecycle` in `packages/platform/src/lifecycle/routes.admin.ts`, beside
`registerCommandHookAdminRoutes`. It is gated by `requireAdmin('platform.modules.read')` and its
response schema is `PolicyPointPlanResponseSchema`. It is read-only, because participants are
shipped module code.

```ts
export const PolicyPointPlanPointSchema = z.object({
  id: z.string(),
  owner: z.string(),
  combiner: z.enum(['chain', 'commutative']),
  budgetMs: z.number().int().positive(),
  onFailure: z.enum(['refuse', 'substitute']),
});
export const PolicyPointPlanItemSchema = z.object({
  point: z.string(),
  module: z.string(),
  participantId: z.string(),          // 'default' for the owner's
  isDefault: z.boolean(),
  /** chain: 1-based, default = 1; commutative: null. */
  position: z.number().int().positive().nullable(),
  reasonCodes: z.array(z.string()),
  declaredOverride: z.boolean(),
  /** chain only; per process, since boot: evaluated at least once and never read `previous`. */
  observedOverride: z.boolean().nullable(),
  /** Read live from the effective state. */
  moduleEnabled: z.boolean(),
  /** 189 `contracts/module-origin.md` §1, imported, not restated. */
  origin: z.enum(MODULE_ORIGINS),
  /** True only for a `package` participant admitted by a `policyParticipantGrants` entry. */
  granted: z.boolean(),
});
export const PolicyPointPlanResponseSchema = z.object({
  points: z.array(PolicyPointPlanPointSchema),
  items: z.array(PolicyPointPlanItemSchema),
});
```

- Points are sorted by id.
- Items are sorted by point, then position for `chain`, then `(module, participantId)` for
  `commutative`.

## 2. Admin shell screen `/platform/policy-points`

- **Files.** `packages/admin-shell/src/modules/platform/PolicyPointsPage.tsx` with
  `policy-points-api.ts`, modelled on `CommandHooksPage.tsx`. The page reuses `DataTable`,
  `PageHeader`, `StatusBadge` and the empty and loading states from `@endora-commerce/admin-kit`
  (Principle IX).
- **Content.**
  - It shows one section per point (owner, combiner, budget, failure treatment), with its
    participants underneath.
  - An absent module renders as "switched off", never hidden.
  - Each participant shows its origin as a `StatusBadge` (`core`, `deployment`, `package`), with
    every value through `defineEnumLabels`. A `package` participant also shows "Granted by the
    deployment", with `help` text naming `divergence.ts`.
  - An observed override shows a warning badge with `help` text explaining the term.
- **Route and navigation.** The route is in `packages/admin-shell/src/App.tsx`, beside the
  command-hook routes. The AppShell entry sits beside *Command hooks* in
  `packages/admin-shell/src/components/AppShell.tsx` (`module: null`, `requiredPermission:
  'platform.modules.read'`).
- **Palette.** The `_lifecycle` manifest (`packages/platform/src/lifecycle/manifest.ts`) gains
  `open-policy-points`: `targetRoute: '/platform/policy-points'`, `requiredPermission:
  'platform.modules.read'`, with keywords `policy`, `rules`, `decision` and `moderation`.
- **Translations.** All strings are in `_lifecycle`'s bundles, in English and Polish.

## 3. Divergence entry

```text
key:     policy-participant:<overlayModule>:<pointId>#<participantId>
kind:    policy-participant
module:  <overlayModule>
subject: <pointId>#<participantId>
owner:   <point's owner module id>
rung:    3
detail:  { kind: 'policy-participant', point, combiner, participantId, position: null, override: 'declared' | null }
reason:  the deployment's sentence from divergence.ts `reasons[key]`
```

- It is derived from the overlay modules' `policyContributions` and from the owner's
  `policyPoints`, which the generator reads from the generated index.
- A participation whose point no manifest declares is the finding `unowned-policy-point`.

**Grants** (D-295 item 5) are derived from the declaration, as omissions are:

```text
key:     policy-participant-grant:<moduleId>:<pointId>
kind:    policy-participant-grant
module:  <granted package's module id>
subject: <pointId>
owner:   <point's owner module id>
rung:    3
detail:  { kind: 'policy-participant-grant', point, packageName }
reason:  the grant's own inline reason (never `reasons[key]`)
```

- A grant whose point no manifest in the tree declares is the finding `unowned-policy-point`.
- A grant naming a module the tree composes as core or as one of this deployment's overlay modules
  is the finding `policy-grant-not-a-package`.
- Whether the granted package is installed, and which participants it contributes, is a run-time
  fact: `runtimeOnly` names it, and the boot refusal (`InvalidPolicyParticipantGrantError`) is its
  check.
- `packages/cli/src/lib/divergence.ts` `SEAM_CLASSIFICATION` gains:
  - `policyParticipants: { verdict: 'divergence', kind: 'policy-participant', rung: 3 }`;
  - `policyPoint: { verdict: 'not-a-seam', why: 'a module declaring its own decision point' }`.
- Runtime half: the boot log line `kernel.policies` lists `{ point, module, participantId, position,
  origin, granted }` once, beside `kernel.decorations`.

## 4. `module:status <id>` (and `--json`)

`runStatusCommand` (`@endora-commerce/platform/lifecycle`) prints two new blocks from the manifest
set:

```text
Policy points declared:   organizations.moderation (commutative, 5000 ms, substitute)
Policy contributions:     organizations.moderation#registry-confirmed (reason codes: 2)
```

- For a `chain` point, a contribution prints its module-granularity position, derived from the
  dependency closure and `policyOrder`. If the manifests leave the order open, it prints
  `unordered with <module>`.
- The `--json` form adds `policyPoints` and `policyContributions` arrays with the manifest shapes.
- The command composes nothing (D-157.2).

## 5. Checks

- **`check:port-dependencies`** learns one rule. A `policyContributions[].point` must be declared
  in some manifest's `policyPoints`, otherwise the finding is `unowned-policy-point`. The
  contribution adds no ledger edge, because it is non-binding (research R-2).
- **The module-i18n coverage test** learns one rule. Every `policyPoints[].defaultReasonCodes` and
  `policyContributions[].reasonCodes` entry resolves `<pointId>.reason.<code>` in both of the
  declaring module's bundles. This uses the instrument that already resolves manifest-declared keys
  (`specs/conventions/module-i18n.md`).
- **The divergence check** (`check:divergence`, the existing instrument over the report) learns the
  two grant findings above. They are merge-request feedback; the boot refusal stays the guarantee.
- **Static checks.** No new `check-*` script is added.
