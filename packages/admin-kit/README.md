# `@endora-commerce/admin-kit`

The admin surface a module package's `./admin` layer is written against
(feature 091, `specs/091-module-owned-admin-surfaces/`).

## What it publishes

Five subpaths, each an explicit barrel, all resolving at `./dist`:

| Subpath | What it is |
| --- | --- |
| `./ui` | the shadcn/Radix primitives — `button`, `alert`, `card`, `page-header`, `input`, `label`, `form-field` (`FormField`, see below), `help-tip` (`HelpTip`), `switch` (`Switch`, see below), `setting-row` (`SettingRow`), `inline-status` (`InlineStatus`, `useInlineStatus`, see below), `select`, `badge`, `table`, `checkbox`, `textarea`, `multi-select`, `combobox`, `save-button-group`, `color-picker`, `route-tabs`, `separator` |
| `./components` | the composites — `ResponsiveTable`, `PaginationFooter`, `RuleBuilder`, `StickyFormActions`, `TouchReorderButtons`, `<EChart>` with `useChartColors` and `prefersReducedMotion`, the analytics figure frame `FigureCard` with `useFigure`, `ModalDialog`, `SavedViewsControl`, `CustomFieldListFilters` with `useCustomFieldListFilterFields` and its helpers (`readCustomFieldFilterParams`, `writeCustomFieldFilterParams`, `sanitizeCustomFieldFilters`, `pruneRemovedOptions`, `customFieldFilterChips`, `customFieldFilterRefusal`, `toCustomFieldFiltersParam`, `customFieldDisplayName`, `resolveCustomFieldLabel`, `emptyCustomFieldFilters`, `withCustomFieldFilter`, `withoutCustomFieldFilter`), the pickers, the reorder helpers |
| `./lib` | `apiClient`, `format`, `money`, `utils` (`cn`), `text-normalization` (the one `foldDiacritics` / `slugify` owner), `uuid`, the unsaved-changes prompt and `isDraftEqual` (the guard itself, `useUnsavedChangesGuard`, is `./components`'), the icon map, the page-size options, the analytics range presets (`RANGE_PRESETS`, `presetRange`, `isDayRange`) — and, since P3, the **session cluster**: `AuthProvider` / `useAuth`, `ModulePresenceProvider` / `useModulePresence`, `useSurfaceVisibility` and `usePageSizePreference` — and, since feature 164, the signed-in administrator's server-held Admin UI preferences: `useAdminPreference` / `useAdminPreferencesStatus` (provided by `AuthProvider`; `usePageSizePreference` reads them too) — and, since feature 180, the **save session** an editor's one Save covers its zone panels with: `SaveSessionProvider`, `useSaveSession`, `useSaveParticipant`, the pure `runSave` and `INERT_SAVE_SESSION` (`specs/180-one-save-zone-editors/contracts/save-participation.md`) |
| `./i18n` | `useTranslation`, `TranslationProvider`, the language context and the resolver |
| `./contributions` | the declaration types, re-exported from `@endora-commerce/contracts` so a module needs one import for the shapes and not two |

**The membership is derived, never designed** (`admin-kit-surface.md` §1). Re-measured
on the day Phase 1b landed: **1782** reaches from **329** files under the admin's module
directories land on **62** distinct host modules, with `button` (186), `alert` (161) and
`card` (142) at the top. Of those 1782, **1690 are published here** and the 92 that are
not are ledgered, named, and each has a retiring condition — see below.

The transitive closure of that surface inside `admin/src` is **74 files**, of which **57**
moved into this package and **17** deliberately did not.

## How it is wired, and the property that has to hold

The implementations **moved**; `admin/src` keeps a one-line re-export shim at each of the
**53** old paths a remaining admin file names. So all 1690 existing `@/…` specifiers work
unchanged and every binding has exactly one home — the shape feature 080 used for the
platform relocation.

Those shims later moved into `@endora-commerce/admin-shell` with the rest of the host, and
issue #97 removed the last of them: the shell names `@endora-commerce/admin-kit/*` directly,
and a test that replaces a kit binding mocks that same specifier.

`admin-kit-surface.md` R4 originally said the kit would be a **façade** over `admin/src`
with nothing moving. It cannot be built, and both halves of the reason were measured on a
two-file probe:

```
src/ui/index.ts(1,24): error TS6059: File 'admin/src/components/ui/button.tsx'
  is not under 'rootDir' '…/src'. 'rootDir' is expected to contain all source files.
admin/src/components/ui/button.tsx(4,20): error TS2307: Cannot find module '@/lib/utils'
```

Dropping `rootDir` makes it compile and emits a **second copy** of every component into
this package's `dist` — a duplicated module-scope value in a tree full of React context,
which is what `check:singleton-identity` refuses on the backend and for which there is no
frontend instrument at all.

So the property that has to hold is *one copy*, and it is asserted by reference equality
rather than by structure: `admin/test/kit/admin-kit-identity.test.ts` compared the binding
reached through a shim with the binding reached through the barrel using `toBe`, for a
function, a component, the API-client singleton, the `ApiError` class (`instanceof`) and a
React context, until the shims were removed (issue #97); it still compares the kit's
page-size options with the contracts array. A second `createContext()` passes every
structural comparison and is a `null` context at runtime with no type error; that is the
failure the comparison existed to make impossible.

## What is still not published, and why

Two groups, 8 reaches, every one of them in `backend/scripts/ledgers/admin-surface.ts`
with its retiring condition. Both opened much larger — 77 reaches when Phase 1b closed —
and both were drained by a publication rather than by the batch that met them. `check:admin-surface` holds the ledger both ways, so neither
group can grow quietly and neither can be left behind once it is repaired.

**`asset-picker` (4 reaches).** Phase 1b left four pickers here, on the ground that each
fetched from **another module's** API client and publishing it would put module knowledge
in the kit and break R6. **P2 retired three of the four** — `sales-channel-picker`,
`cms-picker` and `organization-picker` are published above, because a picker whose module
knowledge is a *request* stops having any once the request is rebuilt from the published
`apiClient` and the owner's contract types. That is the same exit Phase 4's batches three
and five took for a module screen, and it is not the exit this section predicted: it said
the group *"retires with Phase 2"* through a zone contribution, and Phase 2 landed and
retired none of them, because the zone mechanism is P4's and does not exist yet.

~~`asset-picker` is left, and for a reason of kind rather than of size: its module knowledge
is `assets_library`' `AssetPicker` **component**, which no URL replaces. It is FR-007's
worked example and **retires with P4**.~~ **Retired by P4c instead (!1225/!1230), not by P4** — see
the withdrawal below; it needed no mechanism. Inverting the pickers to take their data by prop
was considered and rejected in Phase 1b and stays rejected: it moves the module knowledge
to the consumer, which owns the data no more than the kit does.

**The two tab strips over two modules' pages (4 reaches).** This entry read *"the admin's
session and module-presence state, 73 reaches"* and named the four hooks. **P3 published all
four**, and they are in the `./lib` row above.

What blocked them was never a design question — it was a measurement, and the measurement was
right. 23 of the admin's test files mocked those modules **at the module path**, on purpose:
`TaxesPage.permission-gating.test.tsx` said so in its own comment, *"the mocks stop at
`useAuth` and `useModulePresence` deliberately, so the real `useSurfaceVisibility` is the
thing under test rather than a stub of it."* `vi.mock` keys on a module id, so moving
`surface-visibility` here alongside `auth` put that seam **inside** the package, where those
mocks could not reach it. Measured by doing it: **36 files and 179 tests**, every one failing
with `useAuth must be used inside <AuthProvider>` — and **37** by the time it landed, because
a module with an off-state test of its own arrived on `master` in the meantime. A count
describes one commit; re-derive the population against the tree that will run. They drive the real providers now, seeded
through `initial` on both — a better test on its own terms, because a permission gate
asserted against a stub of the predicate asserts that the stub was consulted.

What is left is `InvoiceSectionTabs` and `OrderEntryTabs`, which are components rather than
hooks and were never blocked by the same thing. Each renders on two modules' pages and
belongs to neither — `invoices` and its templates screen, `orders` and `quick_order` — so
publishing one would put that pairing in the kit, which is module knowledge (R6). They
**retire with P4**, like `asset-picker`: a tab strip over two modules' surfaces is a zone
with two contributions.

**The substitution seam for the session cluster is a prop, not a mock**, and that was
measured rather than chosen. `AuthProvider` takes `initial: AdminMe` and
`ModulePresenceProvider` has taken `initial` since feature 073; supply either and the
provider starts resolved and skips its boot fetch. The alternative — a kit file importing
`apiClient` from this package's own `./lib` barrel, which is the seam P2 established for the
three published pickers — **does not work for a member of that barrel**: it is a cycle, and
under a `vi.mock` factory calling `importActual` it resolves to the *real* module, so the
stub is bypassed silently and the request goes out to whatever is listening on the API
origin. `auth.tsx` and `module-presence/api.ts` therefore import `./api-client.js` directly
and say so in place. The same is true of `i18n/language-storage.ts` and the five older
data-fetching components, which is `specs/deferred-defects.md`'s entry from !1212.

`PAGE_SIZE_OPTIONS` was the one binding Phase 1b split out of a module that stayed behind:
the **constant** was design-system and the **preference** was application state, because the
hook reads the signed-in admin's id. That id is `useAuth`'s, which is published now, so the
split has nothing left to separate — both halves are here.

## How a kit component gets its data

**It builds the request itself, from the published `apiClient` and the owner's contract
types.** That is not a new rule — five components did it before P2 (`CustomerPicker`,
`AdminUserPicker`, `CustomerGroupPicker`, `CategorySelect` and `useCountriesQuery`, the
last of them over `dictionaries`' public dictionary facade) — but it had never been
written down, which is how four pickers came to be blocked on a mechanism nobody was
building.

The rule R6 states is *no module knowledge*, and an HTTP path plus a schema out of
`@endora-commerce/contracts` is not module knowledge: the kit already depends on that
package, both sides compile it, and Principle II makes it the one place the shape is
defined. What R6 refuses is a **module's code** — its admin API client, its components, a
module id in a branch — and that is exactly what a rebuilt request removes.

Two alternatives were weighed and rejected. **Taking the data by prop** moves the module
knowledge to the consumer, which owns it no more than the kit does, and rewrites every
public component API and every consumer. **Injecting a loader through a kit context**
is the same displacement with a registration step, and it would make a picker's behaviour
depend on which provider happened to be mounted — untypeable at the call site and
invisible to `check:admin-surface`.

~~The limit is stated so it is not discovered later: a picker whose module knowledge is a
**component** has nothing to rebuild. `asset-picker` renders `assets_library`' own
`AssetPicker`, so it stays unpublished until P4's zone mechanism exists.~~

**Withdrawn, 2026-08-31 (P4c, !1225/!1230).** That limit was drawn one level too shallow and
`asset-picker` is now published. Its module knowledge was never the component: `AssetPicker` is 153
lines calling `apiClient.get` over a path, with every type already in `@endora-commerce/contracts`,
and `AssetUploader` posts multipart over the `apiBaseUrl` the kit publishes. Reading it as a
component-shaped reach kept 19 ledger keys waiting on a mechanism they never needed.
`CustomFieldValuesPanel` (P4e, !1232) was the second case of the same misreading.

**What decides it instead** — the rule that replaced this paragraph: a reach is a **zone
contribution** when the *owner* decides that it appears, and a **published component** when the
*consumer* does. Mechanically: does the consumer pass a value in and get one back? See
`specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md` §Z1.

## Rules

- **A key is reused when its *value* is already in `core`, not when its *name* looks generic.**
  R-1's repairs folded `common.close` into `common.action.close` and `common.loading` into
  `common.state.loading` because both were **byte-identical** in `en` and `pl`; `common.search` had no
  `core` equivalent and was added to the `common.action.*` family rather than kept as a
  component-scoped near-duplicate. `CategoryTreePicker` folded **none** of its seven — *"Loading
  categories…"* is not `common.state.loading`'s *"Loading…"*, and `core` already carries
  `countrySelect.loading` = *"Loading countries…"* beside the generic one, so a kit component keeping
  its own specific sentence is the established shape here. Folding by name is a copy change wearing a
  refactor's clothes.

- **Every dependency the kit renders with is a `peerDependency`** so the application
  resolves one copy (R7). Two copies of `react-router-dom` is two router contexts and a
  `useNavigate()` that throws; two copies of `react` is hooks that fail at runtime with no
  type error.
- **No wildcard subpath** (R1) and **no `export *` in a barrel** (R2) —
  `check:admin-surface` exits 2 on a barrel it cannot enumerate, because a short published
  set reports *more* findings and its obvious repair is to widen the barrel silently.
- **No root export** (R3): a consumer names the group it wants, so a reach is legible in
  the import line.
- **The kit adds no component** (R5): a component that exists only here is one the admin
  application does not use, which is how a design system acquires two answers to one
  question. New pieces go into the admin first and are published in the same merge request.
- **Tailwind utility classes are permitted** (R9), and that is the deliberate asymmetry
  with the storefront: the admin has exactly one first-party UI and no theme to negotiate
  with (D-15).
- **Both `tsconfig.base.json` `paths` entries are written, and the bare one names a file
  this package deliberately does not have.** R3 gives the kit no root export, so a consumer
  names the group it wants. The pair is written anyway because
  `workspace-resolution.test.ts` requires both or neither — one of the two is still a
  capture — and the missing target fails closed: `tsc` falls through to node resolution,
  which the `exports` map refuses for `.` exactly as it should. (The reason lives here
  rather than beside the entry because that test reads `tsconfig.base.json` with
  `JSON.parse`, which rejects a comment.)
- **This package carries no `endora` block**, and that is load-bearing:
  `backend/test/unit/harness/workspace-resolution.test.ts` reads that block to decide which
  members are *refused* a `tsconfig.base.json` `paths` entry. The kit is a library the
  admin and a module's admin layer resolve, not a member the platform composes, so it takes
  both entries.
- **`vite` is a devDependency for one type declaration.** Five moved files read
  `import.meta.env` — one for the API base URL, four to keep a diagnostic out of a
  production bundle — and the expressions are kept **verbatim**, because Vite replaces
  `import.meta.env.VITE_API_BASE_URL` at build time and a cast or an indirection is a
  chance for that replacement to stop happening in a way no type-check can see. Nothing
  imports `vite`, so it does not reach `dist` and is not a consumer's dependency.

## Form fields — `FormField` and `HelpTip`

Issue #1432 (UX audit 2026-11-17, DS-08). Every labelled input in a module's admin layer goes
through `FormField`, so no screen wires `htmlFor`, `aria-describedby` or `aria-invalid` by hand:

```tsx
<FormField label={t('field.email')} hint={t('field.emailHint')} error={errors.email} required>
  <Input type="email" value={email} onChange={onEmail} />
</FormField>
```

- **The child is cloned with the wiring** — `Input`, `Select`, `Textarea`, `Checkbox` and any
  component that forwards `id` and `aria-*` to its input. For a control that needs the wiring
  somewhere other than its root, pass a function: `{(control) => <Picker inputId={control.id} />}`.
- **`group`** is for a composite with no single labellable element (an address block, an asset
  picker): the field becomes a `role="group"` named by the label, and the descriptions describe the
  group. A `<label for>` pointing at nothing is worse than none.
- **`hint` is one line** and is clamped to it; longer text goes to **`help`**, a `HelpTip` (a ⓘ
  disclosure beside the label, opened by click, tap or keyboard, closed by Escape — never a
  hover-only tooltip). **`description`** is linked like the hint but never clamped; it exists for
  copy that is not yet short enough to be a hint, and the content rule in
  `specs/conventions/module-i18n.md` is what retires it.
- **`error`** marks the control `aria-invalid`, comes first in its `aria-describedby`, and renders
  into a polite live region that is mounted, empty, from the first render.
- **`required`** is an asterisk hidden from assistive technology plus `aria-required` on the
  control; native `required` is left to the caller, so a form's own validation is not replaced by
  the browser's.
- **Spacing is the field's, margins are the form's**: label → control 6 px, control → hint 4 px,
  no outer margin — the form's `space-y-4` keeps field → field the larger gap (Law of Proximity).
- `labelAddon` (badges, a copy button — outside the `<label>`, so not in the accessible name),
  `action` (end of the label line, as in `Section`) and `describedBy` (ids of descriptions rendered
  elsewhere) cover the editor rows that carry more than a label.

The behaviour is pinned in `admin/test/kit/kit-form-field.test.tsx`, including an axe pass.

## Unsaved changes — `useUnsavedChangesGuard`

Issue #1446 (UX audit 2026-11-17, DS-13). A screen that holds edits a navigation would lose arms
**one** guard; there is no second implementation to pick from:

```tsx
const dirty = !isDraftEqual(draft, saved);          // ./lib — key order and undefined keys ignored
const guard = useUnsavedChangesGuard({ dirty, onSave: save, onDiscard: reset });
…
<UnsavedChangesHint dirty={dirty} />                 // beside the Save button
<Select onChange={(e) => guard.confirm(() => switchLanguage(e.target.value))} />
{guard.dialog}
```

- **What it intercepts**: `beforeunload` (the browser's own prompt — it cannot be replaced); every
  same-origin link click, the sidebar and Back links included, in the capture phase before React
  Router; with `guardTabsOutside`, a `role="tab"` outside the given element; and whatever the screen
  routes through **`confirm(action)`** — its own `navigate()` calls and any in-screen switch that
  would reload over the draft (a channel or a language select).
- **What it asks**: *Save and continue* (the one primary action; the navigation goes ahead only if
  `onSave` resolves `true`, and a refused save leaves the operator on the screen with its own error),
  *Discard changes* (`onDiscard`, then the navigation), *Stay here* (the initial focus, so an Enter
  pressed by accident keeps the work). Without `onSave` — no permission, nothing valid to send — the
  choice is Discard or Stay. Copy is `core`'s `form.unsavedChanges.*`; `title` and `message` override it.
- **The blocked link or tab is replayed**, not re-routed: the same element is clicked again with the
  guard stood down, so the guard needs no router and keeps whatever the link does.
- **Not interceptable here**: Back / Forward. The admin mounts a component `<BrowserRouter>`, not a
  data router, so React Router's `useBlocker` is unavailable; that would take moving `AdminRoot` to
  `createBrowserRouter`.
- **`dirty` is the draft against the last saved version**, never "the operator typed something":
  compare what a save would send, so a canvas that re-emits an equal tree, or a field typed and
  cleared again, is not an edit.
- `UnsavedChangesHint` is a polite live region mounted empty (WCAG 4.1.3) and deliberately not a
  `role="status"`, so it never competes with the screen's own save-result region.
- `useUnsavedChangesPrompt` (`./lib`) is the same interception with the browser's two-way `confirm()`
  and stays for screens that have no Save to offer; `UnsavedChangesDialog` is the question on its own,
  for a screen that decides itself when to ask. `PageBuilderEditorLayout`
  (`@endora-commerce/page-builder-admin`) takes `dirty` / `onSave` / `onDiscard` and arms the guard
  for the whole editor.

The behaviour is pinned in `admin/test/kit/kit-unsaved-changes-guard.test.tsx`, including an axe pass.

## On/off — `Switch` and `SettingRow`

Issue #1442 (UX audit 2026-11-17, DS-09). `Switch` is the one on/off control; `SettingRow` is the
settings-list layout it reads best in — label and description on the left, control on the right.

```tsx
<SettingRow label={t('settings.listPrice.label')} description={t('settings.listPrice.help')}>
  <Switch checked={value} onCheckedChange={setValue} />
</SettingRow>
```

**When to use a switch** (owner decision DEC-04): every **boolean setting**, and every **toggle that
takes effect immediately**. In a form that is saved later, only where the label **describes a
state** ("Visible on the storefront", "Active"); a label that is a statement the operator agrees to
or an action ("I accept the terms", "Send a copy to me") stays a `Checkbox`. Never a `true`/`false`
`Select`, and never a filled "Enable" button per row.

- **It is a native `<button type="button" role="switch" aria-checked>`** — no new dependency
  (there is no `@radix-ui/react-switch` in the tree, and the button already brings Space/Enter,
  focus and `<label for>` naming). It never submits a surrounding form. `FormField` and
  `SettingRow` clone it with the id and descriptions like any other control; it carries
  `data-state="checked" | "unchecked"` for styling.
- **Always controlled**: `checked` + `onCheckedChange(next)`. A staged setting writes the draft and
  leaves the write to the page's Save; an immediate toggle starts its write in `onCheckedChange`,
  sets **`busy`** while it is in flight (`aria-busy`; further presses are ignored, so the write
  cannot be doubled) and puts the kit's `ImmediateBadge` on its section heading, as every other
  immediately-applied control does.
- **Disabled**: `disabled` is the native attribute, for a control inside a disabled `fieldset` or
  one whose reason is already on screen. **`disabledReason`** is for one whose reason is not: the
  switch stays focusable, is `aria-disabled`, ignores presses and is described by the reason (also
  its `title`) — a natively disabled button drops out of the tab order and its reason is never
  heard. Show the reason visibly too, in the row's `hint` or `description`.
- **State is never colour alone**: the thumb's position carries it as well (SC 1.4.1); the
  unchecked track is `muted-foreground`, so its boundary meets 3:1 against the page (SC 1.4.11).
- **Target**: the track is 36 × 20 px; on a coarse pointer an invisible pseudo-element grows the hit
  area to 44 × 44 px (Fitts's Law), and the label toggles it too. The slide is `motion-safe` only.
- `SettingRow` is `FormField` with `layout="row"`: the same wiring, `error`, `hint`, `help`,
  `labelAddon` and `action`. A screen that needs the row inside a larger editor can pass
  `layout="row"` to `FormField` directly, as the Settings screen's row editor does.

The behaviour is pinned in `admin/test/kit/kit-switch.test.tsx`, including an axe pass.

## Messages — `Alert` and `InlineStatus`

Issues #1484 and #1443 (UX audit 2026-11-17, SHELL-08 and DS-10). Two primitives, chosen by
what the message is:

- **The result of an action** ("Saved", "Copied", "Status changed") is an **`InlineStatus`** next
  to the button that produced it — owner decision DEC-12 (a). It is a `role="status"`,
  `aria-live="polite"`, `aria-atomic` region that is **always mounted** and empty until there is
  something to say, because a live region that arrives already carrying its text is not reliably
  announced (WCAG 2.2 SC 4.1.3). `useInlineStatus()` holds its state: `show(message, tone?)` after
  the action, `clear()` on the next edit; showing the same text again re-announces it. The message
  does not disappear on a timer.

  ```tsx
  const status = useInlineStatus();
  // on success: status.show(t('settings.saved')); on the next edit: status.clear();
  <div className="flex items-center gap-3">
    <Button onClick={save}>{t('common.save')}</Button>
    <InlineStatus {...status.props} />
  </div>
  ```

  `tone` is `success` (default), `error` or `info`; success and error carry an icon, so colour is
  never the only signal. `visuallyHidden` announces without showing — for a control whose visible
  state already changed (a badge, a reordered row). An `InlineStatus` is always polite; an error
  that has to interrupt is an `Alert`.
- **A banner** — a page-level error, a warning about the record, a static notice — is an
  **`Alert`**. Its role follows its variant: `destructive` is `role="alert"` (interrupts),
  `success` is `role="status"` (polite), `default` and `warning` have **no live role**, because
  most of them are present when the page loads and announcing them is noise. `live` chooses
  explicitly: `live="assertive"` for a warning that needs attention now (a refused or partly
  failed action), `live="polite"` for a banner that appears as the result of an action,
  `live="off"` for a static error. An explicit `role` still wins (`role="note"`). The default
  table is exported as `ALERT_DEFAULT_LIVE` and the mapping as `alertRole(variant, live)`.
  Success and warning colours come from `--success-soft` / `--warn-soft` and their `-fg` tokens.
  Every `Alert` carries `data-slot="alert"` and `data-variant`, so a test can find a banner that
  has no role without matching on class names.

The behaviour is pinned in `admin/test/kit/kit-inline-status.test.tsx`, including an axe pass.

## Known rough edge

`./i18n` publishes `resolve` (the translation resolver) under that bare name, because it
is the name every existing caller and both of its tests already use and this merge request
is a move. It is a poor name on a public barrel and renaming it is a `major` under R12 —
worth doing before the first package is published, not inside a change whose subject is a
file relocation.

## Dialogs — `ModalDialog` is the only one

Issue #1444 (UX audit 2026-11-17, DS-11). Every modal question or form in the admin is
`ModalDialog` (`./components`), or its yes/no form `ConfirmDialog` / `useConfirmDialog`. It carries
what a hand-drawn scrim leaves out:

- `role="dialog"`, `aria-modal`, the accessible name from `title` (`aria-labelledby`) and, through
  `aria-describedby`, the question or warning read with it;
- a focus trap: focus moves in on open (`initialFocusRef`, else the first focusable control, else the
  panel itself) and back to the opener — or `finalFocusRef` — on close;
- Escape and a press on the scrim close it; with two open, only the topmost answers Escape;
  `dismissOnScrim={false}` keeps a dialog holding typed input open on a stray click;
- `busy` — Escape and the scrim are inert while a request is in flight, and `aria-busy` says so;
- a **portal to `document.body`**, so a dialog opened inside a drawer moved with `transform`, a table
  row or a `<ul>` is placed against the viewport and does not nest a `<div>` where markup forbids it;
- `layer` — `page` (default, `z-50`, the layer the kit's popovers share, so a select inside still
  opens above the dialog) or `overlay` (`MODAL_OVERLAY_Z_INDEX`, above the fullscreen Page Builder
  and its 9999 floating action bar), for a dialog opened from inside the builder.

```tsx
<ModalDialog title={t('x.dialog.title')} onClose={close} busy={busy} footer={<>{cancel}{apply}</>}>
  …
</ModalDialog>
```

A `fixed inset-0` overlay, a `position: 'fixed'` style object, `createPortal`, or a `role="dialog"`
written by hand anywhere under the admin, the shell, the kit, the page-builder chrome or a module's
`src/admin/` / `src/admin-ui/` fails `admin/test/unit/no-hand-rolled-overlays.test.ts`, whose
two-way ledger names each remaining one and the issue that migrates it. The behaviour is pinned in
`admin/test/components/ModalDialog.test.tsx`, including an axe pass.
