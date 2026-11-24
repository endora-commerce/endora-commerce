# Contract: the policy point `organizations.registrationConflict`

Mechanism: `specs/188-policy-points/` (D-295, #1839). Owner: `organizations`. Schemas in
`packages/contracts/src/organization-join-requests.ts`. Research R-9. Where this contract and 188
disagree on the *mechanism's* spelling (manifest field name, participant registration seam,
conformance helper), 188 wins and this file is amended in the same merge request; the input,
verdict, default and failure semantics below are this feature's.

## 1. Declaration (in `organizations' manifest.ts`)

```ts
policyPoints: [
  {
    id: 'organizations.registrationConflict',
    combiner: 'chain',
    input: RegistrationConflictInputSchema,
    verdict: RegistrationConflictVerdictSchema,
    defaultParticipant: 'registration-conflict-setting',   // implemented in organizations
    onParticipantFailure: 'fail-closed',                   // → { decision: 'refuse' }
  },
],
```

## 2. Schemas

```ts
export const RegistrationConflictInputSchema = z.object({
  /** The request's resolved channel; null outside a request. */
  salesChannelId: z.string().uuid().nullable(),
  taxIdScope: z.enum(['global', 'per-tree-root']),
  /** What the one tax-ID lookup answered (`TaxIdLookupService.resolveByTaxId`); `none` never reaches the point. */
  match: z.enum(['one', 'ambiguous']),
  /** The resolved target, null when `match` is `ambiguous`. No name, no tax ID. */
  target: z.object({
    organizationId: z.string().uuid(),
    isRoot: z.boolean(),
    status: organizationStatusSchema,
  }).nullable(),
}).strict();

export const RegistrationConflictVerdictSchema = z.object({
  decision: z.enum(['refuse', 'join_request']),
}).strict();
```

## 3. Participants

- **Default (innermost)** — `organizations`: answers `{ decision: settings['organizations.registration.conflict_policy'] }`,
  read through `settingsReadPort` per call (no cache of its own; the settings module's is enough).
- **Contributed** — any module declaring a `contributes-to` edge on `organizations` for this point;
  ordered after the default by module `dependencies`, receiving `(input, previous)`. A participant
  of a module that is off is skipped (XVII). Example: a wholesale overlay answering `refuse` for
  every channel but one. **Which modules may contribute is 188's rule**: core and overlay modules,
  and an installed third-party package only when the deployment's committed divergence declaration
  (`divergence.ts`, `DeploymentDivergenceDeclarationSchema`) grants it explicitly — owner answer of
  2026-11-23 to 188; an ungranted package refuses composition, and the grant appears in the
  divergence report. This point adds no rule of its own on top.

## 4. The owner's validation (after the chain)

1. The verdict fails `RegistrationConflictVerdictSchema` → `refuse`.
2. `match === 'ambiguous'` or `target === null` → `refuse`, whatever the chain answered.
3. Otherwise the verdict stands. `join_request` with `target.status !== 'active'` is allowed: the
   request is routed to the operator (FR-045), and the reply is identical.

`refuse` is today's `409 ORGANIZATION_TAX_ID_EXISTS`. `join_request` is the path of
`join-requests.md` §1 `create`.

## 5. Where it is asked

Once, in `RegistrationService.registerOrganization`, after the existing pre-check found a live
match and **before** the e-mail pre-check, the password hash and the custom-field validation — so a
refusal costs what it costs today. The daily-limit pre-check follows a `join_request` verdict. The
Command does not ask again: it re-resolves the target only to detect the race (R-10).

## 6. Interim (188 not yet merged)

`decideRegistrationConflict(input, settings)` in
`packages/modules/organizations/src/backend/services/registration-conflict-policy.ts` = the default
participant + §4. Adopting 188 replaces its call with the point's evaluation and moves the
function body into the declared default participant. Same tests.

## 7. Tests

- the conformance helper of 188, run with and without a test participant (SC-007);
- default `refuse` on a fresh settings store (SC-001);
- a participant that throws, times out or answers `{ decision: 'merge' }` → `refuse`;
- `ambiguous` with a chain answering `join_request` → `refuse`.
