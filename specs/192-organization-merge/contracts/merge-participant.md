# Contract: a merge participant

Every module whose persisted rows reference an Organization or a Project implements one
participant per host type it references. The participant runs inside its owner and uses only its
owner's own Commands. Its dispositions and blocking issues are listed in
`participant-dispositions.md`.

## 1. Interface (`packages/contracts/src/record-merge.ts`)

```ts
export interface MergeStepInput {
  mergeId: string;
  hostType: RecordMergeHostType;
  survivorId: string;
  loserId: string;
  /** Host-written context, typed per host (Organization: { roleMap: Record<string, string> }). */
  hostContext: Readonly<Record<string, unknown>>;
  batchSize: number;
}

export interface MergeParticipantPreview {
  counts: Readonly<Record<string, number>>;     // remaining rows per declared reference ("Entity.property")
  conflicts: readonly { code: string; resolution: string; details?: Record<string, unknown> }[];
  warnings: readonly { code: string; details?: Record<string, unknown> }[];
  /** A refusal stops the start (FR-026, R-20). Codes from data-model §6 or the participant's own. */
  refusals: readonly { code: string; retryable: boolean; details?: Record<string, unknown> }[];
}

export interface MergeParticipant<H extends RecordMergeHostType = RecordMergeHostType> {
  readonly host: H;
  /** Read-only. Counts what is still the loser's and would move; must reach 0 after the step. */
  preview(input: Omit<MergeStepInput, 'batchSize' | 'mergeId'> & { mergeId?: string }): Promise<MergeParticipantPreview>;
  /**
   * Moves at most `batchSize` rows still held by the loser, in ONE Command of this module
   * (action `<prefix>.merge_reassign`), and returns how many it moved; 0 means done.
   * Must consume loser-side state (research R-3) so that a re-run never duplicates.
   */
  applyBatch(input: MergeStepInput): Promise<{ moved: number }>;
}
```

## 2. Rules

1. **One Command per batch**, from the owner's `src/backend/commands/`. It is `reversible: false`,
   it declares no `event`, and its audit has `objectType` = host type, `objectId` = survivor, and
   `stateAfter = { mergeId, loserId, moved, ids }` (R-12).
2. **The same Command is published on the aggregate port** where the owner has one (R-4). The method
   is `reassignOrganization(fromId, toId, { mergeId?, limit }, options?)` or the name given in
   `participant-dispositions.md`. A deployment may call it, and its `options.source` is recorded.
3. **Consume loser-side state** (research R-3 table). The remaining count reaches 0 by construction.
4. **Refresh what you own** after each batch: reindex the moved ids, and invalidate caches keyed by
   either id through your lifecycle pub/sub invalidation (R-17).
5. **No other module's tables**, ever. Data the participant needs from the host comes from
   `hostContext` or the host's read port.
6. **Do not check permissions.** The host's start Command was the gate. Never expose the
   participant to a route.
7. **Off.** The runner never calls a participant whose module is off. The participant does not
   check this itself.
8. **Bounded batches.** Default 500. Members use 50 (one 191 Command per account). Each batch
   finishes in under 5 s at reference volume.
9. **Text is never rewritten.** Mentions resolve at render time (FR-093).

## 3. Conformance helper (`@endora-commerce/test-kit`, `merge/expect-merge-participant.ts`)

```ts
await expectMergeParticipant({
  participant, seed,                    // seed(survivorId, loserId) creates rows of every declared reference
  expect: { dispositions },             // per reference: the expected end state
});
```

It asserts that:

- the preview counts equal the rows moved;
- `applyBatch` never exceeds `batchSize`;
- a failure injected between the survivor write and the loser consume rolls back whole;
- a second full run moves 0 and changes nothing (no duplicate union rows, no double sum);
- the audit entries carry `mergeId` and no values (`expectNoAuditValues`);
- no event is dispatched;
- the participant is absent from the composed set when its module is off.
