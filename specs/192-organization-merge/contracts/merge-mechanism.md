# Contract: the platform merge mechanism ("merge points")

Owner: `@endora-commerce/platform`, `kernel/merge/` (R-1). It is exposed to modules through the
manifest (`merge`), through the module context (`ctx.merge`), and through the types in
`packages/contracts/src/record-merge.ts`. This document is the design record. Once the mechanism is
merged, the rule's single home is a new item in `specs/conventions/module-composition.md` ("2b. A
record you own can be merged; a record you reference must follow").

## 1. Manifest declarations

```ts
// in ModuleManifest (packages/platform manifest schema), additive
merge?: {
  /** Only the module that owns the record type. One host type per declaration. */
  hosts?: readonly MergeHostDeclaration[];
  /** Every module whose persisted rows reference a host's records. */
  participates?: readonly MergeParticipationDeclaration[];
};

export interface MergeHostDeclaration {
  type: RecordMergeHostType;               // 'organization' | 'project'
  phases: readonly string[];               // ORGANIZATION_MERGE_PHASES | PROJECT_MERGE_PHASES
}

export interface MergeParticipationDeclaration {
  host: RecordMergeHostType;
  key: string;                             // unique within the module, kebab-case
  phase: string;                           // one of the host's phases, never 'finalize'
  trailing?: boolean;                      // may finish after finalize (R-16)
  freeze?: 'orm' | 'guarded';              // FR-046: 'guarded' when a reference is also set in SQL or a native call
  references: readonly {
    entity: string;                        // entity class name in this module
    property: string;                      // property holding the host id(s), or the polymorphic id
    polymorphic?: { discriminator: string; value: string };   // e.g. { discriminator: 'scope', value: 'organization' }
    disposition: MergeDisposition;
  }[];
}
```

A participation whose every reference is `kept` or plain `survivor_wins` writes nothing: it has no
phase, no step and no participant. The host module declares its own moved references under the
reserved key `host-structure` in the `structure` phase; they are moved by the host's
`applyStructureBatch`, not by a registered participant, and no other module may use the key.

Composition refuses each of the following at boot (FR-045 runtime half):

- a `participates` entry for a host type no composed module declares (dropped with a warning, like
  188 FR-004, because the host's module may be platform-unavailable);
- two modules declaring the same host type;
- a participation without a matching `ctx.merge.participate` registration, or the reverse;
- a phase not in the host's list, or `finalize`.

## 2. Module context

```ts
ctx.merge.participate<H extends RecordMergeHostType>(host: H, key: string, participant: MergeParticipant<H>): void;
ctx.merge.host<H extends RecordMergeHostType>(host: H, impl: MergeHostImplementation<H>): void;   // host module only
```

`MergeParticipant` is specified in `merge-participant.md`. `MergeHostImplementation` is what the
runner calls for the host's own phases:

```ts
export interface MergeHostImplementation<H extends RecordMergeHostType> {
  /** Host-specific refusals and the field diff. Read-only. Runs before every participant preview. */
  preview(input: { survivorId: string; loserId: string }): Promise<HostMergePreview<H>>;
  /** The host's structure-phase work (children, roles → host_context, …), batched like a participant. */
  applyStructureBatch(input: MergeStepInput): Promise<{ moved: number }>;
  /** The host's finalize Command: field values, archive pointer, tax ID, event, search. Runs once. */
  finalize(input: MergeStepInput): Promise<void>;
}
```

## 3. The runner

- **Queue** `platform.record-merge` (BullMQ, `ctx.worker` pattern of the platform outbox drain
  worker). There is one job per merge, with `jobId = mergeId`, so a duplicate enqueue is a no-op.
- **Scope.** Every call runs under `withSystemScope('record-merge:<mergeId>')`. The actor recorded by
  step Commands is `system`, with `source = 'record-merge'`. The starting actor is on the merge
  record and on the start Command's audit entry.
- **Loop.** For each phase in order: create the missing step rows, then run the steps (parallelism
  4). A step whose module is not effectively present is marked `deferred`. Otherwise the runner calls
  `applyBatch` until `moved: 0`, recording counts after each batch.
- **Failure.** A thrown batch is retried 5 times with exponential backoff (2 s base). After that the
  step becomes `failed` and the merge `needs_attention`. The runner publishes on
  `b2b:record-merge:changed` and logs it. (The admin notification through `admin_notifications`
  is the admin stage's, MR-F: the platform cannot name a module, so it needs a seam of its own.)
- **Finalize.** The runner re-runs `preview` for every present, non-trailing participant. A non-zero
  remaining count re-queues that step, up to 3 sweeps, and then `needs_attention` with
  `RECORD_MERGE_RESIDUE`. With zero everywhere it calls `host.finalize`, releases the locks, moves the
  loser from the frozen set to the archived set, and publishes.
- **Trailing steps** run after finalize. The merge is `completed`, and the steps show their own
  state.
- **Catch-up** (R-10). There are two paths:
  - a subscription to `b2b:module:state-changed`;
  - a repeatable job `platform.record-merge.catch-up` every 15 minutes, which selects deferred steps
    whose module is now effectively present and runs them under the original merge id.

## 4. Freeze and archive seams (R-6, R-8)

| Seam | File | Behaviour |
| --- | --- | --- |
| Tenant resolution | `packages/platform/src/tenancy/resolve-tenant-context.ts` | customer / bound API-key request on a frozen Organization: unsafe methods answer `409 RECORD_MERGE_IN_PROGRESS`; on an archived one: `409 ORGANIZATION_MERGED` |
| Org write guard | `packages/platform/src/tenancy/org-write-guard.ts` | create/update of an `@OrgScoped` row carrying a frozen or archived Organization id is refused unless the ambient scope reason is `record-merge:<the merge's id>` |
| Reference guard (FR-046) | `packages/platform/src/tenancy/merge-reference-guard.ts` | every ORM create, upsert and update that sets a declared, not `kept`, reference — any entity, an id array, a text key, a polymorphic id whose discriminator names the host — to a frozen or archived record is refused the same way |
| Guarded SQL (FR-046) | the participant module | a participation declared `freeze: 'guarded'` calls `assertMergeWritable(host, ids)` (`@endora-commerce/platform/tenancy`) before each SQL statement or native call that sets a reference, or skips a view-state write with `mergeWriteRefusal`; `check:merge-participation` finds the sites |
| Host routes / ports | the host module | writes naming the loser refused with the same codes |

An archived record's refusal carries the **last** survivor: finalize re-points every record merged
into the loser earlier (FR-020a), and the archived set follows the chain. A merge whose loser is the
survivor of a completed merge with a step left to catch up is refused `409
RECORD_MERGE_ALREADY_RUNNING` with that merge's id (FR-020).

## 5. Host-facing operations (implemented by the platform, called by the host's Commands)

```ts
export interface RecordMergeService {   // container name: recordMergeService (platform-internal to hosts)
  /** Inserts merge, locks and step rows; adds to the frozen set; enqueues. Call inside the host's start Command. */
  begin(em, input: { hostType; survivorId; loserId; fieldChoices; customFieldChoices; hostContext; actor; source }): Promise<RecordMergeRecord>;
  cancel(em, mergeId: string, expectedVersion: number): Promise<RecordMergeRecord>;
  resume(em, mergeId: string, expectedVersion: number): Promise<RecordMergeRecord>;
  get(mergeId: string): Promise<RecordMergeRecord | null>;
  list(filter: { hostType; state?; recordId? }): Promise<RecordMergeRecord[]>;
  /** Aggregated preview: host preview + every present participant's preview + completeness. */
  preview(hostType, survivorId: string, loserId: string): Promise<RecordMergePreview>;
  isFrozen(hostType, id: string): boolean;
  archivedInto(hostType, id: string): string | null;
}
```

As implemented, the service also carries what a host's Commands need inside their own
transaction: `setHostContext(em, mergeId, patch)` and `hostContextWithin(em, mergeId)` (the
Organization role map), `getWithin(em, mergeId)`, and `announce(mergeId)`, which the host calls
**after** its Command committed — it refreshes this process's frozen set, publishes on
`b2b:record-merge:changed` and enqueues a running merge. `begin` takes an optional `mergeId` so the
start Command's audit entry and hook data carry the id it is about to insert. The type is published
on `./kernel` (`RecordMergeService`); the instance is root-registered as `recordMergeService`.
`ctx.merge.host` / `ctx.merge.participate` are no-ops in a context built by hand for one module
(no registry, no runner).

## 6. Shapes returned to hosts and admin

```ts
export interface RecordMergePreview {
  refusals: readonly { code: string; details?: Record<string, unknown> }[];   // empty = may start
  fields: readonly { code: string; survivor: unknown; loser: unknown; default: 'survivor' | 'loser' }[];
  customFields: readonly { key: string; survivor: unknown; loser: unknown; default: 'survivor' | 'loser' }[];
  participants: readonly {
    moduleId: string; key: string; phase: string;
    counts: Readonly<Record<string, number>>;            // per reference, e.g. { 'Order.organizationId': 1243 }
    conflicts: readonly { code: string; resolution: string; details?: Record<string, unknown> }[];
    warnings: readonly { code: string; details?: Record<string, unknown> }[];  // e.g. credit over limit
  }[];
  incomplete: readonly string[];                         // present modules with undeclared references (R-9)
}

export interface RecordMergeRecord {
  id: string; hostType: RecordMergeHostType; survivorId: string; loserId: string;
  state: RecordMergeState; version: number;
  startedAt: string; completedAt: string | null; cancelledAt: string | null;
  lastErrorCode: string | null;
  steps: readonly { moduleId: string; key: string; phase: string; state: RecordMergeStepState;
                    movedCount: number; deferredReason: string | null; lastErrorCode: string | null; trailing: boolean }[];
}
```

The preview **omits** participants whose module is off (Principle XVII). Their steps appear only
after their module is present again.

## 7. Tests (owned by the platform)

- `kernel/merge/composition.test.ts`: every refusal of §1.
- `kernel/merge/runner.test.ts`: phase order, parallelism, retry, needs_attention, resume, cancel
  window, finalize residue sweep, trailing.
- `kernel/merge/catch-up.test.ts`: the pub/sub path and the sweep path.
- `kernel/merge/locks.test.ts`: racing starts.
- `tenancy/org-write-guard.merge.test.ts`, `tenancy/resolve-tenant-context.merge.test.ts`: the
  freeze and archive refusals, and the merge-scope exemption.
