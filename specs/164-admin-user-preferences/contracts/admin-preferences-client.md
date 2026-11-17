# Contract: admin preferences in the Admin UI (`specs/164-admin-user-preferences/`)

Normative for `@endora-commerce/admin-kit` (the store, the page-size hook, the carry-over) and
`@endora-commerce/admin-shell` (the Pinned section, collapsed groups, rail mode, the notice).
Research: R-6 – R-11.

## §1 The store — `packages/admin-kit/src/lib/admin-preferences/`

| File | Contents | Published from `@endora-commerce/admin-kit/lib` |
| --- | --- | --- |
| `store.ts` | the per-key state machine, write queue, refetch, deltas (no React) | no |
| `AdminPreferencesProvider.tsx` | context; mounted **by `AuthProvider`** while authenticated, `key={me.adminUser.id}`, `initial={me.preferences ?? null}` | no (internal; `AuthProvider` is the public seam) |
| `use-admin-preference.ts` | `useAdminPreference`, `useAdminPreferencesStatus` | **yes** |
| `legacy-carry-over.ts` | §4 — the only file naming the legacy keys | no |
| `../use-page-size-preference.ts` | re-implemented over the store, signature unchanged | yes (already) |

```ts
type SidebarKey = 'sidebarPins' | 'sidebarCollapsedGroups' | 'sidebarRailMode';

export function useAdminPreference<K extends SidebarKey>(
  key: K,
): readonly [AdminPreferences[K], (next: AdminPreferences[K]) => void];

export function useAdminPreferencesStatus(): {
  /** `unavailable` — loaded nothing; defaults shown, nothing is being saved (FR-018). */
  availability: 'available' | 'unavailable';
  /** A save failed and has not succeeded since; render the notice once (FR-017). */
  unsavedNotice: boolean;
  dismissNotice(): void;
};

export function usePageSizePreference(scope: string): {
  pageSize: PageSizeOption;
  setPageSize: (next: PageSizeOption) => void;
};
```

Outside an `AuthProvider` the hooks throw, as `useAuth` does. A test that wants preferences
seeds them through `AuthProvider`'s existing `initial` prop (`initial.preferences`). The two
ways a session arrives read an absent field differently, deliberately: a **fetched** `/admin/me`
without `preferences` (an older backend) or with `null` puts the store in **unavailable** mode;
a **seeded** `initial` without the field gets the defaults in **available** mode, because a
seeded session is one the test chose — so the existing tests that seed `initial` without the
field keep working. Such a test that changes a preference sends a `PATCH` through the kit's
`apiClient`; tests that do so stub it, as the saved-views tests stub theirs.

### §1.1 Per-key state and the write rules

```text
state(key) = { value, inFlight: boolean, pending?: value, unsaved: boolean }

set(key, v):
  value := v                                     # optimistic, synchronous (FR-017)
  if availability = unavailable: record delta(key, v); tryLoad(); return
  if inFlight: pending := v; return              # coalesce: only the newest waits
  send(key, v)

send(key, v):
  inFlight := true
  PATCH /me/preferences { [key]: wire(key, v) }
  on 2xx: inFlight := false; unsaved := false; clear notice episode if no key unsaved
          adopt response[key] only if no pending
          if pending: v' := pending; pending := ∅; send(key, v')
  on error: inFlight := false; unsaved := true; raise notice once per episode
          if pending: v' := pending; pending := ∅; value := v'  (send on next trigger)

retry triggers (every unsaved key, latest value): window 'online'; visibilitychange→visible;
  the next set(key, …)

refetch: on visibilitychange→visible (and after a successful retry burst):
  GET /me/preferences; for each key: if !inFlight && !pending && !unsaved: value := remote[key]
  (one refetch at a time)
```

`wire(listPageSizes, …)` sends only the one changed list (`{ [scope]: size }`), never the map.

### §1.2 Unavailable mode (FR-018)

Entered when the session carries `preferences: null` or none. Values are the defaults; nothing
is sent. Deltas recorded per `set`:

| Key | Delta |
| --- | --- |
| `sidebarPins` | ordered `added[]`, set `removed` (an add then remove of one destination cancels) |
| `sidebarCollapsedGroups` | set `folded`, set `unfolded` |
| `sidebarRailMode` | last value |
| `listPageSizes` | last size per list |

`tryLoad()` runs on `online`, foreground and every `set`, one at a time. On success: apply the
deltas onto the loaded values (pins: `loaded − removed`, then append `added` not already
present; groups: `(loaded ∪ folded) − unfolded`; rail and sizes: the delta value), `send` each
**touched** key, availability := available, then run the carry-over (§4 step 2+). Untouched keys
are never written.

### §1.3 Isolation

The provider is keyed by admin id: a different admin is a different store, nothing carried over
(US1 AS-7). A new `me` for the same admin is applied as a refetch result (§1.1).

## §2 The shell — `packages/admin-shell/src/`

### §2.1 Pure helpers — `lib/pinned-entries.ts`

```ts
export interface ResolvedPin {
  destination: string;
  item: NavItem;            // the composed entry's own object — label, icon, gating
  sectionKey: string;       // for the accessible description (spec edge case)
  end: boolean;             // the NavLink `end` the original row computes
}
export function resolvePinnedEntries(
  pins: readonly string[],
  sections: readonly NavSection[],
  isVisible: (item: NavItem) => boolean,
): ResolvedPin[];          // stored order; first VISIBLE entry per destination; hidden → omitted
export function pinDestination(pins: readonly string[], d: string): string[];   // append if absent
export function unpinDestination(pins: readonly string[], d: string): string[];
/** Slot-preserving: hidden pins keep their indices; visible slots take `visibleOrder`. */
export function reorderVisiblePins(pins: readonly string[], visibleOrder: readonly string[]): string[];
```

`NavItem`/`NavSection` are exported as types from `AppShell.tsx` (or moved to
`components/sidebar/nav-types.ts`) for this file to name.

### §2.2 Rendering rules

| Where | Rule |
| --- | --- |
| Order | The Pinned section renders **before** `composedNav.map(…)` in the expanded sidebar and the mobile drawer, and as the **first** `RailSection` in rail mode (FR-002, US1 AS-9) |
| Absence | No visible pin ⇒ no section, no heading, no rail icon (FR-002, US2 AS-4) |
| Rows | The original's icon and `navLabel(item)`; `NavLink` with the original's `end`; `aria-describedby` → "from {section}" for the source section (edge case) |
| Pin control | `<button type="button" aria-pressed={pinned}>` after the link in every original row and every pinned row; name `appShell.pinned.pin` / `appShell.pinned.unpin` with `{label}`; revealed on `:hover` / `:focus-within`; always shown, ≥ 44 × 44 px, in the mobile drawer and under `(pointer: coarse)` (FR-004, US1 AS-10) |
| Collapse | Heading button toggles group key `pinned` in `sidebarCollapsedGroups` (FR-013) |
| Reorder | `useReorderList` over the visible pins, `TouchReorderButtons` per row, `ReorderAnnouncer`; `onReorder(next)` → `reorderVisiblePins(stored, next.map(d))` (FR-009). Not in the rail popover |
| Rail popover | Lucide `Pin` icon; popover rows = pinned rows with the unpin control (FR-004) |
| Announce | Polite live region: pinned / unpinned / moved (FR-005) |
| Notice | `useAdminPreferencesStatus().unsavedNotice` ⇒ kit `Alert` below the top bar with a dismiss button, text `adminPreferences.saveFailed`, also announced politely; never a dialog (FR-017) |
| Palette | No entry or group added (FR-024); a pin control beside existing results — §2.3 (FR-027) |

### §2.3 Pinning from the command palette (FR-027, research R-15, R-16)

```ts
// lib/pinned-entries.ts
export function visibleDestinations(
  sections: readonly NavSection[],
  isVisible: (item: NavItem) => boolean,
): ReadonlyMap<string, { item: NavItem; sectionKey: string; end: boolean }>;   // first visible per `to`

// components/sidebar/use-pin-actions.ts — shared by the sidebar and the palette
export function usePinActions(): { isPinned(d: string): boolean; toggle(d: string): void };

// AppShell → CommandPalette
interface CommandPaletteProps { open; onClose; onNavigate; pinTargets: ReturnType<typeof visibleDestinations> }
```

| Rule | |
| --- | --- |
| Pinnable row | `pinTargets.has(row.to)` — exact equality, any group (Navigate, Actions, Records, …); never the assistant sentinel or "see all" |
| Control | **Amended by issue #481:** the row is a `role="option"` in the palette's listbox, and an option's children are presentational, so the control is `<span aria-hidden="true" data-palette-pin data-pinned title={t(pinned ? 'appShell.pinned.unpin' : 'appShell.pinned.pin', { label: navLabel(target.item) })}>` — a pointer shortcut for `Alt+Enter`, not a second widget. The option carries `aria-keyshortcuts="Alt+Enter"` and, in its name, `appShell.palette.pin.statePinned` / `stateUnpinned`. Unchanged: lucide `Pin`/`PinOff`, on every pinnable row; ≥ 44 × 44 px under `(pointer: coarse)`; `onMouseDown` → `preventDefault` (focus stays in the input); `onClick` → `stopPropagation`, `toggle(row.to)`. (Originally a `<button tabIndex={-1} aria-pressed aria-keyshortcuts aria-label>`.) |
| Keyboard | `Alt+Enter` on the highlighted row: `preventDefault`; toggle if pinnable, else nothing; never navigates or closes. The existing `Enter` branch becomes `Enter && !altKey` |
| Hint | highlighted pinnable row shows `⌥↵`/`Alt+↵` + `appShell.palette.pin.hintPin` / `hintUnpin`; the input has `aria-describedby` → hidden `appShell.palette.pin.instructions` |
| Announce | a polite live region **inside** the palette dialog, mounted empty, receives `appShell.pinned.announce.pinned` / `.unpinned` with the sidebar entry's label |
| Effect | the Pinned section updates at once (same store); the palette stays open on the same query and highlight |

### §2.4 Collapsed groups and rail mode

`AppShell` reads `useAdminPreference('sidebarCollapsedGroups')` and
`useAdminPreference('sidebarRailMode')`; `toggleSection` and `toggleRailMode` write them.
`STORAGE_KEY`, `RAIL_STORAGE_KEY`, `loadCollapsed`, `persistCollapsed`, `loadRailMode` and
`persistRailMode` are deleted. Rail mode stays ignored on the mobile tier.

## §3 Page size

`usePageSizePreference(scope)`: at mount, `listPageSizes[scope]` if it is one of
`PAGE_SIZE_OPTIONS`, else 20; held in local state thereafter (an open list is never resized by a
refetch); `setPageSize(n)` updates local state and `set('listPageSizes', …)` for that scope.
`packages/admin-kit/src/lib/page-size-options.ts` re-exports
`ADMIN_LIST_PAGE_SIZE_OPTIONS as PAGE_SIZE_OPTIONS` from `@endora-commerce/contracts`. The
`admin-shell` re-export shim (`packages/admin-shell/src/lib/use-page-size-preference.ts`) is
unchanged.

## §4 Legacy carry-over — `legacy-carry-over.ts`

| Legacy key | Shape | Action |
| --- | --- | --- |
| `b2b-admin.nav.collapsed-groups` | JSON array, not keyed by admin | **remove**, never import (ruling (d)) |
| `b2b-admin.nav.rail-mode` | `'1'` / `'0'`, not keyed by admin | **remove**, never import (ruling (d)) |
| `b2b-admin.page-size.<scope>.<adminId>` | decimal string | if `<adminId>` is the signed-in admin's: import, then remove on success; otherwise leave alone |

Algorithm, once per store mount:

1. Remove the two unkeyed keys (also in unavailable mode).
2. If unavailable, stop; it resumes from step 3 when the store becomes available.
3. Collect keys `b2b-admin.page-size.` + `<scope>` + `.` + `<own id>` where the remainder after
   stripping the prefix and the `.<own id>` suffix is the scope; parse each value.
4. Invalid (non-integer, not an option, scope not an `adminListIdSchema`) ⇒ remove, do not send.
5. None valid ⇒ done. Else `POST /me/preferences/legacy-import { listPageSizes }`.
6. 2xx ⇒ remove the sent keys; adopt `response.listPageSizes` for lists with no local
   in-flight/pending/unsaved write. Error ⇒ keep the keys; the next load retries (idempotent).

Every storage call is wrapped in `try/catch` (disabled storage ⇒ nothing to carry over).

## §5 Translations — `core` scope, `packages/modules/_i18n/i18n/{en,pl}.json`

| Key | en | pl |
| --- | --- | --- |
| `appShell.pinned.heading` | Pinned | Przypięte |
| `appShell.pinned.pin` | Pin {label} | Przypnij: {label} |
| `appShell.pinned.unpin` | Unpin {label} | Odepnij: {label} |
| `appShell.pinned.fromSection` | From {section} | Z sekcji {section} |
| `appShell.pinned.fromMain` | From the main group | Z grupy głównej |
| `appShell.pinned.announce.pinned` | {label} pinned | Przypięto: {label} |
| `appShell.pinned.announce.unpinned` | {label} unpinned | Odpięto: {label} |
| `appShell.pinned.reorder.handle` | Move {label} | Przenieś: {label} |
| `appShell.pinned.reorder.grabbed` | {label} grabbed, position {index} of {total}. Use the arrow keys to move, Space to drop, Escape to cancel. | Chwycono: {label}, pozycja {index} z {total}. Strzałki przesuwają, spacja upuszcza, Escape anuluje. |
| `appShell.pinned.reorder.moving` | {label}, position {index} of {total} | {label}, pozycja {index} z {total} |
| `appShell.pinned.reorder.dropped` | {label} dropped, position {index} of {total} | Upuszczono: {label}, pozycja {index} z {total} |
| `appShell.pinned.reorder.cancelled` | Move cancelled. {label} is back at position {index} of {total} | Anulowano przenoszenie. {label} wraca na pozycję {index} z {total} |
| `appShell.pinned.reorder.moved` | {label}, position {index} of {total} | {label}, pozycja {index} z {total} |
| `appShell.pinned.reorder.atStart` | {label} is already first | {label} jest już na początku |
| `appShell.pinned.reorder.atEnd` | {label} is already last | {label} jest już na końcu |
| `appShell.palette.pin.hintPin` | Pin | Przypnij |
| `appShell.palette.pin.hintUnpin` | Unpin | Odepnij |
| `appShell.palette.pin.instructions` | Alt+Enter pins or unpins the highlighted result. | Alt+Enter przypina lub odpina zaznaczony wynik. |
| `adminPreferences.saveFailed` | Your layout change could not be saved. It stays in effect here but will not reach your other devices yet; we will keep trying. | Nie udało się zapisać zmiany układu. Działa w tej sesji, ale nie trafi jeszcze na inne urządzenia; spróbujemy ponownie. |
| `adminPreferences.dismiss` | Dismiss | Zamknij |

Wording is a starting point for `endora-commerce-designer`; the key set is the contract. The
placeholder syntax is the kit's `{name}` interpolation, as in `appShell.brand.versionLabel`
(`en.json:204`). `TouchReorderButtons` brings its own `core` labels (`reorder.groupLabel`,
`reorder.moveUp`, `reorder.moveDown`) and needs no new key.
