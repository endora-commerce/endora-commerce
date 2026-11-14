# Contract: save participation for zone contributions

Owner: `@endora-commerce/admin-kit` (implementation, `packages/admin-kit/src/save-session/`, exported
from `./lib`) and `@endora-commerce/contracts` (the handle type, in `src/admin-contributions.ts`).
Decisions: `research.md` R2–R5, R8. Requirements: FR-001…FR-007, FR-034, FR-062. Widened by OQ-8 = C (research R14–R21).

## 1. The handle in the zone contract (contracts)

```ts
/** Opaque to contributors; created by the host's SaveSessionProvider, stable for its life. */
export interface EditorSaveSessionHandle {
  readonly sessionId: string;
}

export interface ProductEditorZoneProps {
  readonly productId: string;
  /** Feature 180 — the product editor's one Save (FR-002). */
  readonly saveSession: EditorSaveSessionHandle;
}

export interface ProductEditorFieldZoneProps {
  // …unchanged fields…
  readonly saveSession: EditorSaveSessionHandle;
}
```

The same `saveSession` prop is added to the props of every zone an adopting editor mounts:
`CategoryEditorZoneProps`, `OrganizationDetailZoneProps`, `CustomerDetailZoneProps`,
`SalesChannelEditorZoneProps`. Zones of hosts that do not adopt (`spec.md` § *Zone hosts that do not
change*) get no handle, so a contribution there cannot take part (FR-002).

`ProductEditorSeoZoneProps` is unchanged: SEO stays in the host's own write (FR-023).
The handle carries no functions in its public type; admin-kit resolves it to the live session
(`WeakMap<handle, session>`), so contracts stays free of React types.

Every product-editor mount passes `saveSession`; `useAdminZone` probes that pass placeholder props
(`ProductEditor.tsx:196-208`) pass a module-level inert handle.

## 2. Contributor side

```ts
export interface SaveParticipantHandlers<D> {
  /** Number of unsaved changes; 0 = clean. Pure. */
  changeCount(draft: D, baseline: D): number;
  /** All checks, local and server pre-check. Pure of component state. */
  validate(draft: D, ctx: SaveContext): Promise<ParticipantIssues>;
  /** Write the part through the module's own API (its own Command). Returns the new baseline. */
  save(draft: D, ctx: SaveContext): Promise<D>;
}
export interface SaveContext { readonly signal: AbortSignal; }
export interface ParticipantIssues {
  readonly fields: Readonly<Record<string, string>>;   // field key → translated message
  readonly message?: string;                            // part-level message
}

export function useSaveParticipant<D>(
  handle: EditorSaveSessionHandle,
  spec: { key: string; label: string; writable: boolean; loaded: D | null },
  handlers: SaveParticipantHandlers<D>,
): {
  draft: D | null;              // null until `loaded` is first non-null
  setDraft(next: D | ((prev: D) => D)): void;
  issues: ParticipantIssues | null;
  status: 'clean' | 'dirty' | 'invalid' | 'saving' | 'failed';
  error: string | null;
};
```

Rules:

- `key` is local to the module; the id is `${module}:${key}`. Inside an `AdminZone`, `module` is read
  from the zone context `AdminZone` provides (R8). Outside one — a **host-owned section** (FR-006,
  R15) — it is the provider's `hostModule`. A provider without `hostModule` refuses host-owned
  registration with a developer error.
- `loaded` seeds baseline and draft **only when the session has no dirty entry for the id**; a
  remount with a dirty entry shows the kept draft (FR-003).
- A save error a handler throws as `ApiError` with `details.fields` is mapped to `issues.fields`;
  `MODULE_DISABLED` maps to the "switched off" part message (FR-034); anything else to the
  part-level message.
- `writable: false` → the entry never becomes dirty and is not counted.

## 3. Host side

```ts
export function SaveSessionProvider(props: { resetKey: string; hostModule?: string; children: ReactNode }): ReactNode;

export function useSaveSession(): {
  handle: EditorSaveSessionHandle;
  dirtyCount: number;                          // participants only; the host adds its own
  hasWritableParticipant: boolean;
  dirtyParticipants(): readonly SavePart[];    // in zone order
  discardAll(): void;
  notices: readonly string[];
  lastOutcome: SaveOutcome | null;
  run(hostPart: SavePart | null, options?: { stopOnFailure?: boolean }): Promise<SaveOutcome>;
};

export interface SavePart {
  readonly id: string; readonly label: string; readonly blocking: boolean;
  validate(ctx: SaveContext): Promise<ParticipantIssues>;
  save(ctx: SaveContext): Promise<void>;
}

export function runSave(parts: readonly SavePart[], options?: { stopOnFailure?: boolean }): Promise<SaveOutcome>;
```

`run` = `runSave([hostPart, ...dirtyParticipants()])`, then applies the outcome to the entries
(saved → clean with the new baseline; failed → `failed` with issues; refused → `invalid`).
Changing `resetKey` (the editor scope key, OQ-4 A) clears every entry.

## 4. `runSave` semantics (FR-011…FR-016)

1. Validate every part concurrently. If any returns issues → outcome `refused`; no `save` is
   called.
2. For each part in order: `save`. On failure: if `blocking` or `stopOnFailure` → remaining parts
   `not-attempted`, outcome `failed` (nothing written yet) or `partial`; else record `failed` and
   continue.
3. Outcome `saved` when every part saved.

## 5. Generic controls (`./components`, FR-007, research R16)

```ts
export function SaveSessionActions(props: {
  hostCount: number;            // the host part's own unsaved changes
  canSave: boolean;             // FR-035: host writable or any participant writable
  saving: boolean;
  onSave(): void;
  describedBy?: string;
}): ReactNode;                  // StickyFormActions + primary button "Save" / "Save n changes" + note

export function SaveSessionSummary(props: {
  outcome: SaveOutcome | null;
  notices: readonly string[];
  onShow(partId: string): void; // the host moves to the part (tab, section) and focuses its first error
}): ReactNode;                  // Alert per contracts/product-editor-save-ui.md §2
```

`CustomFieldValuesPanel` gains an optional `saveSession?: EditorSaveSessionHandle`; with one it
registers as a host-owned section and renders no Save; without one it is unchanged (FR-062).

## 6. Stability and checks

- Exports are named in `packages/admin-kit/src/lib/index.ts` explicitly (no `export *`).
- No zone name is added or removed, so `check:admin-zones` is unaffected; the props map change is
  checked by `tsc` at both ends.
