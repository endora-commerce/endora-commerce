# Contract: `organizations.moderation`, the first `commutative` point

**Status**: proposed (WP-B). It depends on WP-A and on `specs/186-aggregate-ports/`, which delivers
the approve Command, runnable as a child and recording a caller source code (#1821). There is no
`automation` actor kind: the actor is the ambient `system` (D-293.6).

## 1. The ref — `@endora-commerce/contracts` (`src/organizations.ts`, beside `ORGANIZATION_HOOKABLE_ACTIONS`)

```ts
export const organizationModerationInputSchema = z.object({
  trigger: z.enum(['registered', 'registry_lookup_resolved']),
  organization: z.object({
    id: z.string().uuid(),
    isPersonal: z.boolean(),                       // Organization.isPersonal (`specs/177-tax-id-scope/`)
    country: z.string().length(2),
    taxId: z.string().nullable(),                  // normalised (D-290 / OD-11)
    salesChannelId: z.string().uuid().nullable(),  // first binding; the registration channel
  }),
  registryLookup: z.object({
    outcome: z.enum(['validated', 'failed', 'deferred', 'unverified']).nullable(),
    provider: z.enum(['vies', 'mf_pl', 'format_only', 'gus_pl']).nullable(),
  }),
  firstAccountEmailDomain: z.string().nullable(),   // lower-case domain only, never the address
});

export const organizationModerationVerdictSchema = z.object({
  verdict: z.enum(['approve', 'hold']),             // no 'reject' exists (FR-030)
  reasonCode: z.string().regex(POLICY_REASON_CODE_RE),
});

export const organizationModerationDecisionSchema = z.object({
  verdict: z.enum(['approve', 'hold']),
  reasons: z.array(z.object({ moduleId: z.string(), participantId: z.string(), code: z.string(),
                              codeOwner: z.string() })),
});

export const ORGANIZATION_POLICY_POINTS = {
  moderation: definePolicyPoint({
    id: 'organizations.moderation',
    combiner: 'commutative',
    input: organizationModerationInputSchema,
    verdict: organizationModerationVerdictSchema,
    decision: organizationModerationDecisionSchema,
    budgetMs: 5_000,
    defaultReasonCodes: ['mode_auto', 'mode_manual', 'default_unreadable', 'participant_failed'],
    onParticipantFailure: () => ({ verdict: 'hold', reasonCode: 'participant_failed' }),
    combine: (outcomes) => {
      const holds = outcomes.filter((o) => o.verdict.verdict === 'hold');
      const winners = holds.length > 0 ? holds : outcomes;
      return {
        verdict: holds.length > 0 ? 'hold' : 'approve',
        reasons: winners.map((o) => ({
          moduleId: o.moduleId, participantId: o.participantId, code: o.verdict.reasonCode,
          codeOwner: o.substituted ? 'organizations' : o.moduleId,
        })),   // already sorted by (moduleId, participantId)
      };
    },
  }),
} as const;
```

`organizations/src/manifest.ts` gains
`policyPoints: [toPolicyPointDeclaration(ORGANIZATION_POLICY_POINTS.moderation)]`.

## 2. The owner's composition (`organizations/src/backend/index.ts`)

```ts
const moderationPolicy = ctx.policyPoint(ORGANIZATION_POLICY_POINTS.moderation, {
  default: async () => {
    const mode = await readModerationModeOrNull();            // settingsReadPort; null when unreadable
    if (mode === 'auto') return { verdict: 'approve', reasonCode: 'mode_auto' };
    if (mode === 'manual') return { verdict: 'hold', reasonCode: 'mode_manual' };
    return { verdict: 'hold', reasonCode: 'default_unreadable' };
  },
  validate: (decision) =>
    decision.reasons.length === 0 ? 'a moderation decision carries at least one reason' : undefined,
});
```

`moderationPolicy` is handed to `OrganizationModerationService`. Its
`handleNewlyRegistered(orgId)` is replaced by `evaluateModeration(orgId, trigger)`. The old
`resolveModerationMode` constructor argument goes, because the default rule reads the setting now.

## 3. The reactor

`ctx.subscribe('organization.registered.v1')` triggers the reactor with trigger `registered`.
`ctx.subscribe('organization.tax_id_validation.resolved.v1')` triggers it with trigger
`registry_lookup_resolved`. Both run inside `withSystemScope('organizations: evaluate the
moderation policy', …)`.

1. Load the organization. If it is missing, or its status is not `pending_verification`, return.
   Note its `version`.
2. Build the input. The registry lookup comes from `vatValidationOutcome` and
   `vatValidationProvider`. The channel comes from the kernel's channel-membership reader (first
   binding). The e-mail domain comes from `customerAccountReadPort.listByOrganization`: the earliest
   active holder of the Administrator role, as the moderation mail already resolves it.
3. Call `moderationPolicy.evaluate(input)`. `PolicyEvaluationError` cannot be raised by a
   participant failure here, because the point declares a substitute. It can be raised by
   `decision-refused`. If it is, log `organizations.moderation.evaluation_refused` with the trace's
   codes, write nothing and return. The organization stays pending, which is fail-safe.
4. Run `organization.moderation.record_evaluation` on the Command Bus (§4). Its actor is `system`,
   the ambient actor of the system scope above.

## 4. Command `organization.moderation.record_evaluation`

```text
input:  { organizationId, expectedVersion, trigger, decision, trace }
run(ctx):
  org = em.findOne(Organization, { id, deletedAt: null })
  if !org || org.status !== 'pending_verification' || org.version !== expectedVersion:
    return { result: { applied: false }, skipAudit: true }      // FR-039: nothing written
  row = em.create(OrganizationModerationEvaluation, { …decision, failed, skipped, inputDigest, organizationVersion })
  if decision.verdict === 'approve':
    await ctx.run(approveOrganizationCommand({ organizationId, expectedVersion,
                                               source: 'organizations.moderation' }))  // 186's Command, child, same transaction
  return { result: { applied: true, evaluationId: row.id },
           before: null,
           after: { evaluationId, trigger, verdict, reasonCodes, failedParticipants, skippedParticipants } }
```

- The command is not hookable, and it is not reversible.
- The approval e-mail and `organization.status_changed.v1` are the approve Command's, exactly as
  186 specifies. They are dispatched after the commit, never after a rollback.
- `organization.approve`'s version guard runs inside the same transaction, so a concurrent operator
  action rolls the whole Command back. The next registration-free trigger never retries it. This is
  intended: the operator decided.

## 5. Admin read surfaces (organizations)

- **`GET /api/v1/admin/organizations`** (the existing list, `customers:read`). An item whose status
  is `pending_verification` gains
  `moderation: { verdict, evaluatedAt, reasons: [{ code, label, moduleId, participantId }] } | null`.
  This is the latest applied evaluation, read with one `DISTINCT ON` query per page. `label` is
  resolved in the request language through `adminI18nService.translate(codeOwner,
  policyReasonLabelKey(pointId, code))`. A placeholder answer is replaced by the code.
- **`GET /api/v1/admin/organizations/:id/moderation-evaluations`** (new, `customers:read`,
  `organizationInReach`). It returns `{ items: ModerationEvaluationRecord[] }`, the latest 10, each
  holding:
  - `{ id, trigger, verdict, createdAt }`;
  - `reasons[] { code, label, moduleId, participantId }`;
  - `failed[] { moduleId, participantId, kind }`;
  - `skipped[] { moduleId, participantId }`;
  - `inputDigest`.
- Zod schemas `organizationModerationSummarySchema` and `moderationEvaluationRecordSchema` go in
  `packages/contracts/src/organizations.ts`. The list item schema gains the optional field.
- **Admin UI.**
  - `OrganizationsList.tsx` reads `?status=` as its initial filter, so the page can be deep-linked.
    When the status filter is `pending_verification` it shows a *Waiting because* column: the first
    label plus "+n", with every label in the tooltip.
  - `ModerationActionsPanel.tsx` shows the latest evaluation when the organization is pending:
    verdict, reasons, failed rules (with the failure kind's label), skipped rules, trigger and time.
    An expandable history lists the earlier evaluations.
  - An organization with no evaluation shows "No automatic evaluation".
  - Every enum value is rendered through `defineEnumLabels` (`specs/conventions/module-i18n.md`).
- **Palette.** The `organizations` manifest gains the action `open-moderation-queue`:
  `targetRoute: '/organizations?status=pending_verification'`, `requiredPermission:
  'customers:read'`, with `labelKey`, `descriptionKey` and `keywordsKey` in both bundles.

## 6. Behaviour with no contributed rule (FR-045)

| Setting | Before | After |
| --- | --- | --- |
| `auto` | approved, `actorAdminUserId: null`, approval mail | approved through the approve Command by the `system` actor with source `organizations.moderation`, approval mail. An evaluation row is written (`mode_auto`) and audited |
| `manual` | stays pending, nothing written | stays pending. An evaluation row is written (`mode_manual`) and audited |
| unreadable | degrades to manual | stays pending. The evaluation row has `default_unreadable` |

The new rows and audit entries are the only observable additions. SC-002's "apart from" clause
covers them.

## 7. What a contributor may do and may not do

- **May:** read its own tables, keyed by `input.organization.id`. It may call an external service
  with `ctx.signal` within 5 s. It may return `approve` or `hold` with a declared code.
- **May not:** reject; write; emit; or change the organization. All of these are refused or
  impossible by construction.
- **Labels:** the contributor ships `organizations.moderation.reason.<code>` in its own bundles, in
  English and Polish.
- **A third-party package** (origin `package`) contributes only when the deployment grants it
  `organizations.moderation` in `divergence.ts` `policyParticipantGrants` (D-295 item 5). Granted,
  it is a peer of every other rule: its `hold` holds, its `approve` cannot override anyone's `hold`,
  and its failure holds with `participant_failed`. The queue names its module like any other rule's
  (research R-25).
