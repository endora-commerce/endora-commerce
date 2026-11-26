# Quickstart: verifying Organization and Project merge

These steps are for a developer or reviewer on a local stack (`pnpm run build:packages`,
`pnpm run dev:infra`, `pnpm run setup`, `pnpm run dev`) once the relevant MRs are merged. Each
scenario names the spec story it proves.

## 0. Before every port exists (MR-A + MR-B + MR-F)

1. Sign in as a platform administrator holding `organizations:merge`.
2. Open any company Organization, choose *Merge a duplicate into this organization*, and pick
   another company.
3. Expect the preview. It shows the counts of the participating modules and the value differences.
   It lists *Not yet supported: …* for every present module still in the pending ledger, and the
   *Start* button is disabled with `RECORD_MERGE_PARTICIPATION_INCOMPLETE`.
4. Run `pnpm --filter backend run check:merge-participation`. It prints its read-size line and
   passes, with the remaining entries listed as pending.

## 1. US1: merge two duplicates (after MR-E)

1. Seed two company roots, A and B, with `pnpm --filter backend exec tsx scripts/demo/seed-merge-pair.ts`
   (added in MR-B's test fixtures). B gets a member, an address, an open cart, a quote request, an
   order, an invoice, a payer link, a price-list audience and a custom-field value. A gets a
   different value for the same custom field.
2. Preview B into A. Every participant is listed, the custom field shows A's value as the default,
   and the irreversible acknowledgement is required.
3. Start. The progress view walks structure → configuration → addresses → members → records →
   finalize.
4. Check A's screen. It shows B's member (with the mapped role), address, cart, quote, order,
   invoice and payer link, plus the price-list audience.
5. Open B's screen. It shows the *Merged into A* banner, and B is absent from the Organizations list,
   the pickers and admin search.
6. Sign in on the storefront as B's member. They act for A and are not signed out.

## 2. US2: refusals

| Try | Expect |
| --- | --- |
| merge B into B | `RECORD_MERGE_SAME_RECORD` |
| merge a parent into its child | `ORGANIZATION_MERGE_TREE_INVALID` `ancestor` |
| merge two branches of different trees | `ORGANIZATION_MERGE_TREE_INVALID` `different_trees` |
| merge a personal Organization | `ORGANIZATION_MERGE_PERSONAL` |
| as a sales representative not reaching B | 404 |
| while B has an unsettled placement intent | `RECORD_MERGE_BUSY` (retry later) |

## 3. US3: history and old ids

- A's history shows one *Merged B into A* entry, with the steps reachable from it.
- `GET /api/v1/admin/organizations/<B>` returns 200 with `mergedIntoOrganizationId = A`.
- An API-key order create for B answers `409 ORGANIZATION_MERGED` with `details.survivorId = A`.
- A webhook subscribed to `organization.merged.v1` receives exactly one delivery.

## 4. US4: failure and catch-up

1. Run `pnpm --filter backend exec vitest run test/integration/organizations/organization-merge.e2e.test.ts -t "resume"`.
   The test registers a participant double that fails until released. The merge shows
   *needs attention* on it, and after *resume* the counts equal those of an uninterrupted run. There
   is no production switch for fault injection.
2. Switch `crm` off on `/platform/modules` and merge a pair with opportunities on the loser. The
   merge completes, and the progress view shows no CRM step. Switch `crm` on. Within a minute the
   opportunities belong to the survivor, and the merge shows the CRM step as done.

## 5. US5: from server code

From a worker under `withSystemScope('erp-sync')`, call
`organizationCommandPort.startMerge(A, { loserId: B, acknowledgeIrreversible: true }, { source: 'erp_connector' })`
(after #1821). The audit entry records the system actor and `source = erp_connector`.

## 6. US6: projects (after MR-G)

Merge project Q into P. P gains Q's comments (in order and read), attachments, links, Organizations,
members, viewers and tasks (each in P's stage of the same name, else P's current stage). Q shows *Merged into P*. A comment that mentions Q links
to P. With `projects` switched off there is no merge action anywhere.
