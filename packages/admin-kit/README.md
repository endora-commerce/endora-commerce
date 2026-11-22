# `@endora-commerce/admin-kit`

The admin surface a module package's `./admin` layer is written against
(feature 091, `specs/091-module-owned-admin-surfaces/`).

## What it publishes

Five subpaths, each an explicit barrel, all resolving at `./dist`:

| Subpath | What it is |
| --- | --- |
| `./ui` | the shadcn/Radix primitives — `button`, `alert`, `card`, `page-header` (`PageHeader`, see below), `input`, `label`, `form-field` (`FormField`, see below), `help-tip` (`HelpTip`), `switch` (`Switch`, see below), `setting-row` (`SettingRow`), `inline-status` (`InlineStatus`, `useInlineStatus`, see below), `empty-state` (`EmptyState`, see below), `select`, `badge`, `table`, `checkbox`, `textarea`, `multi-select`, `combobox`, `save-button-group`, `color-picker`, `route-tabs`, `tabs` (`Tabs`, `TabPanel`, `RecordTabs`, see below), `editor-section` (`EditorSection`, see below), `separator` |
| `./components` | the composites — `ResponsiveTable`, `PaginationFooter`, `ListToolbar` with `ListToolbarSearch` and `FilterChip` (see below), `ViewModeToggle` (see below), `RowActionMenu`, `DetailHeaderActions` (see below), `RuleBuilder`, `StickyFormActions`, `TouchReorderButtons`, `useServerReorder` with `ReorderControls` (see below), `<EChart>` with `useChartColors` and `prefersReducedMotion`, the analytics figure frame `FigureCard` with `useFigure`, `ModalDialog`, `SavedViewsControl`, `CustomFieldListFilters` with `useCustomFieldListFilterFields` and its helpers (`readCustomFieldFilterParams`, `writeCustomFieldFilterParams`, `sanitizeCustomFieldFilters`, `pruneRemovedOptions`, `customFieldFilterChips`, `customFieldFilterRefusal`, `toCustomFieldFiltersParam`, `customFieldDisplayName`, `resolveCustomFieldLabel`, `emptyCustomFieldFilters`, `withCustomFieldFilter`, `withoutCustomFieldFilter`), the pickers, the reorder helpers |
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
- **`ScopedField`** (`./components`, the scoped editors' field) splits copy the same way since
  issue #1459: `note` is the one clause read with the control, `help` the ⓘ beside the label.
  Since issue #1508 it states a field's scope once: while the "Use value from <parent>" checkbox
  is shown, an inheriting field has **no** "Inherited" / "Not translated" / "No value" badge, and
  the source line appears only for a fact nothing else shows — no value at any scope above, a
  value from further up than the checkbox's parent, a pending untick, a staged tick ("Will use the
  value from … when you save"), or an own empty with its `emptyMeaning`. "Overridden", "Empty
  here", "Unsaved" and "Missing" stay. Without the checkbox (`readOnly`) badge and line stay in full.

The behaviour is pinned in `admin/test/kit/kit-form-field.test.tsx`, including an axe pass;
`ScopedField`'s `help` in `admin/test/kit/kit-scoped-field.test.tsx`.

## Page headers — `PageHeader`

Issue #1436 (UX audit 2026-11-17, DS-02). Every admin page draws its one `h1` through
`PageHeader`; the `.b2b-page-head` classes that drew a title as a `<div>` are gone from
`theme.css`.

```tsx
<PageHeader
  back={{ label: t('warehouses.page.title'), to: '/warehouses' }}
  title={warehouse.name}
  titleActions={<Badge variant="secondary">{t('status.archived')}</Badge>}
  description={warehouse.code}
  help={t('warehouses.page.help')}
  actions={<Button onClick={onNew}>{t('action.new')}</Button>}
/>
```

- **`description` is opt-in and one line**, clamped to it (`line-clamp-1`). Give one only when it
  says something the screen does not already show — a code, a scope, a state — never a restatement
  of the title. The content rule (≤ 80 characters) is in `specs/conventions/module-i18n.md`.
- **`help`** is where a longer explanation goes: a `HelpTip` (ⓘ) beside the title, named
  *"More information: <title>"*, opened by click, tap or keyboard. It is outside the `h1`, so the
  heading's accessible name stays the title.
- **`titleActions`** holds what belongs to the title — an *Edit*, a status badge — beside the
  heading and likewise outside it.
- **`back`** is a link above the title. Its optional `onClick` runs first; call
  `event.preventDefault()` to hold the navigation while an editor asks about unsaved changes.
  It is **the** way back from a detail, create or settings screen (#1549): no outline *Back*
  button among the `actions`, no `ArrowLeft` link above the header —
  `admin/test/unit/no-hand-rolled-back-links.test.ts` refuses both. Give the page its `back` in
  its loading and error states too, so the way out stays in one place.
- **The `back` label names the destination**, as that screen names itself: *Organizations* /
  *Organizacje*, *Price books* / *Cenniki* — reuse the destination's own title key where the screen
  reads that bundle. Never *Back to …*, *All …*, *Wróć do …* or a bare *Back* to a screen the
  page knows (Law of Similarity: one function, one wording). A destination that is one record
  takes the record's name (`feed.name`), with a singular noun until it has loaded. The generic
  `common.action.back` (*Back* / *Wstecz*) is for `?returnTo=` only — the screen cannot name a
  destination its caller chose — and is required there. The same test refuses each departure.

The behaviour is pinned in `admin/test/kit/kit-page-header.test.tsx`, including an axe pass.

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
  Router; the browser's Back / Forward to another screen (#1605); with `guardTabsOutside`, a
  `role="tab"` outside the given element; and whatever the screen
  routes through **`confirm(action)`** — its own `navigate()` calls and any in-screen switch that
  would reload over the draft (a channel or a language select).
- **What it asks**: *Save and continue* (the one primary action; the navigation goes ahead only if
  `onSave` resolves `true`, and a refused save leaves the operator on the screen with its own error),
  *Discard changes* (`onDiscard`, then the navigation), *Stay here* (the initial focus, so an Enter
  pressed by accident keeps the work). Without `onSave` — no permission, nothing valid to send — the
  choice is Discard or Stay. Copy is `core`'s `form.unsavedChanges.*`; `title` and `message` override it.
- **One guard, several questions** (#1606): `confirm(action, { title, message, onStay })` words that
  one ask — a scope switch says it is a switch, while a link keeps the guard's `title` / `message` —
  and `onStay` runs on *Stay here* or Escape, for undoing what the switch already moved (the product
  editor puts back the address the browser's Back / Forward changed). Do not arm a second guard or
  draw a second dialog for the switch.
- **The blocked link or tab is replayed**, not re-routed: the same element is clicked again with the
  guard stood down, so the guard needs no router and keeps whatever the link does.
- **Back / Forward** go through React Router's blocker, which only a data router has: `AdminRoot`
  mounts `createBrowserRouter`. Under a component router (a project's own `<BrowserRouter>`, a
  test's `<MemoryRouter>`) the guard skips them and the browser's behaviour stays. A history step
  that changes only the query stays on the screen and is the screen's to ask about (the product
  editor's scope switch does, through `confirm`).
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

## Keys from names — `deriveKey` and `useDerivedKey`

Issue #1450 (UX audit 2026-11-17, DS-22). A slug, key or code the system can propose from a name is
not typed by hand (Tesler's law), and what the operator does type is normalised rather than refused
(Postel's law). Both live in `./lib`:

```tsx
deriveKey('Gotowe do wysyłki', { separator: '_' });   // 'gotowe_do_wysylki'

const codeField = useDerivedKey({
  source: names.en, value: code, onChange: setCode,
  separator: '_', maxLength: 64, enabled: status === null,
});
<Input value={code} onChange={codeField.onChange} onBlur={codeField.onBlur} />
// in the submit handler: const sent = codeField.commit();
```

- **`deriveKey(name, { separator, maxLength })`** is contracts' `slugify` — the one slug generator,
  diacritics folded (`ł` → `l`) — with `-` by default and `_` for keys and codes.
- **The field follows the name until the operator edits it**; clearing it resumes following. A key the
  screen starts with that the name does not produce counts as edited and is never overwritten.
- **It is normalised on blur** (`In Review` → `in_review`), and empty on blur means "take the name's".
  `commit()` does the same and returns the result, for a submit sent with Enter from the key field.
- **The screen still refuses what stays invalid** — a leading digit, a reserved word — **and a key
  already taken**, against its loaded list and the server's conflict, said at the key. A collision is
  never auto-suffixed (architect ruling on #512): `in_review_2` is a decision nobody made.
- `enabled: false` where the key is fixed (an edit view): the hook then does nothing. The hint under
  the field says where the key comes from and that it cannot change later; the kit carries no copy.

Used by the Tasks status and priority dialogs, the CRM status dialog and the custom-field definition
form. The behaviour is pinned in `admin/test/kit/kit-derive-key.test.tsx`.

## Content languages — `useChannelLanguages` and `offerContentLanguages`

Issue #1507 (UX audit 2026-11-17, CAT-05; architect ruling Q3). A value written per content language
— a category name, a content document, a campaign — is offered in **the union of the active sales
channels' languages**, not in a hard-coded list (Tesler's law). The hook came from `newsletter`'s
admin (#1463), so another module reads the same list without importing that module's code.

```tsx
const channels = useChannelLanguages();                  // { languages, status }
const offer = offerContentLanguages(channels, Object.keys(record.name), [adminLanguageToLocale(language)]);
// offer.editable → one field each; offer.outside → read-only and flagged; offer.degraded → say why
```

- **`useChannelLanguages(current?)`** reads every active channel (one `?activeOnly=true` page) and each
  one's languages, sorted and de-duplicated. A channel whose detail fails offers its default language;
  a list that cannot be read is `status: 'failed'`. `current`, when given, is always in the list (a
  select keeps showing a stored value). `loadChannelLanguages()` is the same read as a promise, for a
  screen that loads it beside its document.
- **`offerContentLanguages(channels, stored, fallback)`** splits a record's stored languages: the
  channels' are `editable` (a stored key differing only in case is kept as stored), a stored one no
  channel offers is `outside` — **shown read-only and flagged, never dropped or edited**. While the
  channels are unknown or offer nothing, `stored + fallback` are editable and `degraded` says why.
- `contentLanguageName(code, adminLanguage)` names a code (`pl-PL` → "Polish (Poland)"). The kit
  carries no copy: the flag, the hint and the degraded sentences are the consumer's.

Used by the newsletter campaign editor and `catalog`'s category tree, category and product content
screens. Pinned in `admin/test/kit/kit-channel-languages.test.tsx`.

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
Nothing else may carry `role="switch"` — a checkbox given the role by hand says *switch* and draws a
tick box; `admin/test/unit/no-hand-rolled-switches.test.ts` holds that (issue #1607).

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

  `tone` is `success` (default), `warning`, `error` or `info`; all but `info` carry an icon, so
  colour is never the only signal. `warning` is a result that went through only in part — sent to
  some recipients, issued without its e-mail (#1499). `visuallyHidden` announces without showing — for a control whose visible
  state already changed (a badge, a reordered row). An `InlineStatus` is always polite; an error
  that has to interrupt is an `Alert`.

  Where it goes when the button is not still on screen (#1499): after a dialog opened from a list
  page's header or a row menu, put it beside the header's primary action, where focus returns; when
  a form remounts on save (a `key` bump), put it in the form card's header, outside the remounted
  part, so it is not created already carrying its text. A list's bulk action goes beside the header's actions
  too: the bulk bar unmounts with the selection. `admin/test/unit/no-success-alert-banners.test.ts`
  lists the screens that still show a success `Alert`.
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

## Cards — `Card` and the density tokens

Issue #1438 (UX audit 2026-11-17, DS-04; owner decision DEC-03). `Card` from `./ui` is the one
card implementation. Its density is a set of tokens in `theme.css`: `--card-pad` (16px, inside a
card), `--card-pad-sm` (12px, a compact strip), `--card-gap` (16px, between cards),
`--section-gap` (24px, between sections inside a card), `--fs-page-title` (20px),
`--fs-section-title` (14px) and `--fs-hint` (12px). Read them as Tailwind arbitrary variables —
`p-(--card-pad)`, `gap-(--section-gap)`, `text-(length:--fs-section-title)` — rather than a
fixed step, so a client's redeclaration reaches every card.

- `CardHeader`, `CardContent` and `CardFooter` pad with `--card-pad`. `CardContent` drops its top
  padding only directly after a `CardHeader`: a card without a header needs no `pt-6`.
- `CardTitle` is an `h2` (the page's `h1` belongs to `PageHeader`). `as="h3"` for a card inside
  another titled section; `as="div"` keeps it out of the outline. Give it the `id` a region's
  `aria-labelledby` points at — never wrap a heading inside it.
- `<Card flush>` drops the content padding and clips the corners, for a table that runs to the
  edge. A `CardHeader` in it keeps its padding.

```tsx
<Card flush>
  <CardHeader>
    <CardTitle id={titleId}>{t('orders.recent')}</CardTitle>
  </CardHeader>
  <CardContent>
    <Table aria-labelledby={titleId}>…</Table>
  </CardContent>
</Card>
```

`Card` is the only card: issue #1502 removed `.b2b-card` and its `__head` / `__title` / `__sub` /
`__body` / `__body--flush` / `__foot` / `--clickable` classes from `theme.css`, together with the
legacy `.b2b-btn*`, `.b2b-field*`, `.b2b-select`, `.b2b-label`, `.b2b-help`, `.b2b-tbl`, `.b2b-row`,
`.b2b-col` and `.b2b-mono` (this package's `CHANGELOG.md` entry for #1502 maps each to its
replacement). The behaviour is pinned in `admin/test/kit/kit-card.test.tsx`, which also refuses a
`CardContent` with `pt-6` and a `CardTitle` wrapping its own heading.

## Sections — `EditorSection` and the `chrome` prop

Issue #1437 (UX audit 2026-11-17, DS-03). **A frame inside a card is a defect unless it is a field.**
A bordered region reads as a separate object (Common Region), so a card inside a card, or a
bordered box around each item of a list inside a card, makes one screen read as several. An editor
tab is one card; what it groups goes into sections inside it. An input's own border, a chip, a
dropzone and a dialog are fields or overlays, not frames, and stay.

- `EditorSection` from `./ui` is the section: a heading (`h2` by default, `as="h3"` inside a titled
  card or section, like `CardTitle`), an optional one-line `description`, an `action` beside the
  heading, and a rule above it when it follows another dividing section (`--section-gap`). The
  region is a `<section>` labelled by its heading. `divider={false}` where the parent already
  separates its children. `Section` is `EditorSection` without the divider and without the region label, kept for its callers.
- `chrome="card"` turns a section into its own `Card`, for the one that stands alone on a page.
  Without the prop the section takes the chrome of its mount, which is `section` everywhere except
  under `<AdminZone chrome="card">`; a section resets it for its children, so a section inside a
  carded one is never a card in a card.
- `CustomFieldValuesPanel`, `RecordHistory`, `CommentThread` and the zone panel frame are sections
  by default and take `chrome="card"`. `CustomFieldValuesPanel` also takes `titleAs`.
  `FieldProtectionSummary` (`./field-protection`) is a section too, with `chrome` and `titleAs`
  (issue #1488, CAT-06); its heading names the source, so two integrations are two sections. History and
  comments render no heading of their own as a section: the host's tab or heading names them.
  `ScopePicker` (`./components`) and `FieldProtectionPricePanel` (`./field-protection`) are sections
  too, with `chrome` and `titleAs` (issue #1503, SHELL-22). Its language checkboxes are a
  `FormField` `group` named *Languages*, not a `<label>` that labels nothing (issue #1599). `RuleBuilder` draws no outer border and
  no heading inside a card, and a group's children are `divide-y` rows; `chrome="card"` (with
  `title`, *Conditions* by default, and `titleAs`) frames one that stands alone. `CommentThreadCopy.hint`, like
  `RecordHistoryCopy.hint`, is optional: give it only for a rule the entries do not show.
- Mount a zone at page level, between the host's own cards, as `<AdminZone … chrome="card" />`;
  inside a card, leave the prop off. A contribution that renders an `EditorSection` follows the
  mount, so the same panel is right in both places.
- A list of items inside a section is rows divided by a rule — `divide-y divide-border` on the
  list, `py-3 first:pt-0 last:pb-0` on the item — not a `rounded-md border` box per item.

**Breaking, visually, for a third-party module** (0.x, so a `minor`): a panel that mounted
`CustomFieldValuesPanel`, `RecordHistory` or `CommentThread` on its own, outside a card, now gets
no card; pass `chrome="card"` to keep it.

### One audited change — `RecordHistoryChangeList`

Issue #1555 (UX audit SHELL-20). The field-by-field list `RecordHistory` draws under each entry is
published as `RecordHistoryChangeList` (`./components`), for a screen that shows one audited change
outside a history — the audit log's row detail. Feed it `recordHistoryChanges(...)` or rows of your
own, a `fieldLabel` and a `renderValue`; it draws the old value struck through with *from* / *to*
spoken, and nothing at all for no rows, so what an empty entry says stays the caller's. Do not draw
a change as two JSON blocks to compare by eye. Pinned in `admin/test/kit/kit-record-history.test.tsx`.

## Tabs — `Tabs`, `TabPanel` and `RecordTabs`

Issue #1445 (UX audit 2026-11-17, DS-12). The one in-page tab strip; `RouteTabs` stays the strip
whose tabs are routes. Both draw `.b2b-tabs` / `.b2b-tab`, so an operator cannot tell them apart.

```tsx
<Tabs items={items} value={tab} onValueChange={setTab} idBase="dictionary" aria-label={t('tabs.label')} />
<TabPanel idBase="dictionary" value={tab}>{panel}</TabPanel>

// A record's sections: the strip across the top of one card, the panel as its body.
<RecordTabs
  items={[{ value: 'notes', label: t('tab.notes'), count: notes.length }, …]}
  value={tab}
  onValueChange={setTab}
  idBase="crm-opportunity"
  aria-label={t('opportunity.tabs.label')}
>
  {panel}
</RecordTabs>
```

- **The WAI-ARIA tabs pattern, automatic activation**, taken from the product editor's working
  strip: one tab in the tab order (roving `tabindex`), ←/→ select and wrap, Home/End jump to the
  ends, a `disabled` tab is skipped. Every tab has `aria-controls` on the strip's **one** panel
  (`${idBase}-tabpanel`) and the panel is `aria-labelledby` the selected tab
  (`${idBase}-tab-${value}`); `tabId` / `tabPanelId` derive them. Only the selected panel is
  rendered.
- **Controlled**: `value` + `onValueChange(next)`. A screen that keeps the tab in `?tab=` writes
  the search params there. The pure keyboard model is `nextTabValue(items, current, key)`.
- **Counts** (`RecordTabs`): `count` draws a badge after the label; zero draws nothing. The
  accessible name says what is counted — `common.tabs.counted`, "Notes, items: 3", or the
  item's own `countLabel` ("Messages, unread: 2"), which must start with the label (SC 2.5.3).
- **Unsaved changes**: `unsaved: t('…unsaved')` on an item draws a dot after the label and adds
  the words to the accessible name ("Modify (unsaved changes)"), so the colour is never the one
  carrier (SC 1.4.1). Leave it `undefined` while the section's draft is clean.
- `icon` is decorative (`aria-hidden`). The panel is focusable (`tabIndex` 0) unless the screen
  passes `-1` because it only focuses the panel programmatically.
- **No tabs inside tabs.** A second level inside a panel hides content two clicks deep and gives
  the keyboard two strips with the same keys: make the second level `Section`s. In development a
  `Tabs` rendered inside a `TabPanel` logs a warning; a `ModalDialog` opened from a panel is a new
  context and does not.
- **A strip with no one panel** — page state spread over the screen — passes
  `controlsPanel={false}`, and its tabs carry no `aria-controls` naming a panel that is not there.

The behaviour is pinned in `admin/test/kit/kit-tabs.test.tsx`, including the keyboard path and an
axe pass.

**`ContentLanguageTabs`** (`./components`) is this strip over content language codes. The screen
owns the panel, because the strip sits in a card header or a canvas bar: pass `idBase` and wrap the
per-language fields in `<TabPanel idBase={idBase} value={activeLanguage} tabIndex={-1}>`. Leave
`idBase` out where the language drives several regions — a Page Builder editor, where it switches
the canvas and the settings fields, and the canvas carries the builder's own tablists. With no language to offer it draws an
`EmptyState` with the reason. Pinned in `admin/test/kit/kit-content-language-tabs.test.tsx`.

**A view that is none of the tabs.** The product browser's status strip is a `Tabs` over one
`TabPanel` (the list). Its *Show selected only* review lists the selection across every status,
so while it is on every item is `disabled`: no tab is selected or a tab stop, and the review is
rendered outside the `TabPanel` — no tab claims what it does not show. The toggle that entered
the review leaves it. `RouteTabs` and `RouteTabsZone` share one strip chrome
(`RouteTabStrip`, kit-internal), so a contributed strip's markup cannot drift from the listed one.

## Empty lists — `EmptyState`

Issue #1448 (UX audit 2026-11-17, DS-15). What a list, a tab or a panel shows when it has
nothing to show: a decorative icon, a title, at most one line and at most one action — never a
bare grey sentence (Picture Superiority). It draws the `.b2b-empty` classes, so do not write
them out by hand. Two variants, because "nothing here yet" and "your filters match nothing" call
for different next steps:

It belongs where the empty area is the page's or the tab's primary region — a list or table page,
a tab whose body is one collection, a top-level record panel. A picker's or combobox's results, an
inline sub-list in a form section and a side or summary widget keep a one-line muted sentence
(architect ruling on #1448).

```tsx
filtered ? (
  // The kit's title, line and Clear filters button; name what the list holds if you can.
  <EmptyState variant="no-results" title={t('list.emptyFiltered')} onClearFilters={clearFilters} focusAfterClear={searchRef} />
) : (
  <EmptyState
    icon={<ClipboardList size={20} />}
    title={t('list.empty.title')}
    description={canWrite ? t('list.empty.body') : t('list.empty.bodyReadOnly')}
    action={canWrite ? createButton : null}
  />
)
```

- `no-data` (the default) needs `icon` and `title`; `description` and `action` are optional.
  Leave the action out for an operator who may not take it and say why in `description`.
  While the list is empty, the empty state's create button is the view's one primary: hide the
  header's *New* (Von Restorff), as the forms, tasks, projects and CRM lists do.
- `no-results` needs only `onClearFilters`, which resets every filter and the search. `icon`
  (default `SearchX`), `title` and `description` override the kit's copy
  (`common.emptyState.*`); the *Clear filters* button is always the kit's outline button.
- **Focus after *Clear filters*** (WCAG 2.2 SC 2.4.3): the button unmounts with the empty state,
  so pass `focusAfterClear={searchRef}` — the list's search box — and the kit focuses it on the
  next frame. Without it, and only when focus was actually lost, the kit focuses the page's `<h1>`,
  else the closest surviving container of the block (both get `tabindex="-1"`). That fallback
  runs once, so a list that reloads asynchronously should always pass a target.
- It is not a live region: it is mounted already carrying its text, which screen readers do not
  reliably announce. The list's result count is the announcement.
- `data-empty-state="no-data" | "no-results"` names the variant for a test.

The behaviour is pinned in `admin/test/kit/kit-empty-state.test.tsx`, including an axe pass.

## Loading a record — `useDetailResource` and `Skeleton`

Issue #1447 (UX audit 2026-11-17, DS-14; SALES-06 is the finding it fixes). A detail screen's
**first load** and its **refresh** are different states, and only the first one has nothing to
show:

- **`useDetailResource(key, load)`** (`./lib`) holds the record. `load` answers the record, `null`
  for one that does not exist, or throws for a failed read. It returns `data`, `initialLoading`
  (true until the first read for this `key` settles), `refreshing` (a re-read with `data` still on
  screen), `error` (the latest read's failure — a first load that fails is an error with a retry,
  never "not found"), `refresh()` (never rejects), `setData` and `busyProps`, which is
  `{ 'aria-busy': true }` while refreshing. A new `key` starts a new first load and never shows
  the previous record; an earlier, slower read never overwrites a later one.
- **`Skeleton`** (`./ui`) is one placeholder block: `aria-hidden`, `data-slot="skeleton"`, sized
  by the caller's classes. Its pulse is `motion-safe:` only, so under `prefers-reduced-motion` the
  shape stays and the motion goes. **`DetailSkeleton`** is a record page's first load — header,
  tab strip (`tabs={false}` drops it) and a card of field rows — inside a `role="status"`,
  `aria-busy` region whose visually hidden text is `label` (default `common.state.loading`).

```tsx
const resource = useDetailResource(id, async () => {
  try {
    return (await apiClient.get<{ data: Order }>(`/api/v1/admin/orders/${id}`)).data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
});
if (resource.initialLoading) return <DetailSkeleton />;
// … not found / load error with retry …
<Card {...resource.busyProps}>…</Card>
// after an action: await resource.refresh(); — the page, its tab and the focus stay
```

**A skeleton is for the first load only.** Returning one, or a "Loading…" line, on a refresh
unmounts the page: the open tab, the scroll position and the focus go with it. The behaviour is
pinned in `admin/test/kit/kit-detail-resource.test.tsx`, including an axe pass.

## Button hierarchy — one primary per view, `DetailHeaderActions`

Issue #1441 (UX audit 2026-11-17, DS-07). The rule, for every admin screen:

- **One primary action per view.** Exactly one filled `Button` (`variant="default"`) — the action the
  screen is for: an editor's one Save, a list's *New …*, a detail page's next step. Everything else
  is `outline`, `ghost` or a link (Von Restorff). A screen with no obvious next step has no primary;
  it never has two. A dialog is its own view, with its own one primary.
- **"Add …" inside a form or a section is `outline`** with a `Plus` icon, not filled: it adds a row
  to what the page's Save writes, it is not the page's goal.
- **Row actions are `ghost` icon buttons with an `aria-label` naming the row** ("Remove Warsaw"),
  or, past two of them, entries of a **`RowActionMenu`**. A row never carries a filled button. A row
  action that writes at once (an immediate *Apply*) is `outline size="sm"`, under the section's
  `ImmediateBadge`. A row's removal is a `ghost size="icon"` `Trash2` button in the destructive
  tone (`text-destructive`), asking before it deletes anything; the product editor's tabs follow
  it (#1489).
- **A 32 px icon-only trigger keeps a 44 × 44 hit area on touch**: `RowActionMenu`'s ⋮ and `LineGroupsEditor`'s heading buttons grow it with a transparent `pointer-coarse:before:` pseudo-element, not a bigger box (Fitts, #1567).
- **Destructive actions sit in a menu and are confirmed.** A `RowActionMenuItem destructive` whose
  `onSelect` opens `useConfirmDialog` — never a red button beside the primary (Fitts: distance, not
  proximity).
- **A detail header is `DetailHeaderActions`**, not a row of four or five outline buttons:

  ```tsx
  <PageHeader
    title={order.number}
    actions={
      <DetailHeaderActions
        primary={<Button onClick={approve} disabled={busy} aria-busy={busy}>{t('orders.approve')}</Button>}
        secondary={<Button variant="outline" onClick={print}>{t('orders.print')}</Button>}
      >
        <RowActionMenuItem onSelect={duplicate}>{t('orders.duplicate')}</RowActionMenuItem>
        <RowActionMenuSeparator />
        <RowActionMenuItem destructive onSelect={askCancel}>{t('orders.cancel')}</RowActionMenuItem>
      </DetailHeaderActions>
    }
  />
  ```

  `primary` is drawn **last** (the right edge, where the main action is expected), `secondary` — one
  or two `outline` buttons — before it, and `children` go into a "More" menu drawn first (Hick: the
  long tail costs one press, not a decision at every glance). The menu entries are the kit's
  `RowActionMenuItem` / `RowActionMenuSeparator`; the panel is the same portalled `DropdownMenu`
  (keyboard, typeahead, focus returned on Escape, never clipped). The trigger is an `outline` button
  with a **visible** label — `core`'s `common.action.more` ("More" / "Więcej") unless `moreLabel` is
  given — so its accessible name is the word on screen (WCAG 2.5.3), and it is **not rendered** when
  every entry is conditional and off. `moreDisabled` + `moreTitle` disable it with a reason;
  `moreBusy` disables it, marks it `aria-busy` and shows a spinner while an entry it started runs
  (Doherty). An entry that opens a dialog runs only once the menu has given focus back to the
  trigger, as in `RowActionMenu`, so the dialog keeps focus and returns it to "More". The group
  renders nothing when it has no action, and carries `data-slot="detail-header-actions"`. The order
  and quote-request detail headers use it (#1497).

  **`status`** — the last header action's result (issue #1499, UX audit SALES-17; DEC-12 a). Pass
  `useInlineStatus().props`: an `InlineStatus` is mounted, empty, before the buttons from the first
  render, and the group renders even when the record has no action left, so "Approved", "Sent to 2
  recipients" or "Invoice issued" is said beside the buttons that caused it rather than as a
  success banner under the header. Above the content a detail screen keeps **at most one** banner:
  an error first, then a standing state that carries its own remedy; a record's state that needs
  no remedy (why it was canceled) belongs in the header's meta line.

The component is pinned in `admin/test/kit/kit-detail-header-actions.test.tsx`, including an axe pass
closed and open. The rule is also § Von Restorff of `.claude/skills/ux-laws/SKILL.md`.

## The editor's one Save — `StickyFormActions`

Issue #1449 (UX audit 2026-11-17, DS-19). An editor has **one** Save (feature 180) and it has
**one** place: the kit's `StickyFormActions`. Long editors had put Save mid-page, at the end of a
long list, or inside the first card while it also saved the zone panels below it.

```tsx
<form onSubmit={save}>
  …cards, sections, zone panels the Save also commits…
  <StickyFormActions
    desktop="sticky"
    dirty={dirty}                       // the kit's UnsavedChangesHint, in the bar
    error={saveError}                   // null while there is none
    status={saveInfo}
    note={t('rfq.detail.modify.notifiesCustomer')}
    secondary={<Button type="button" variant="outline" onClick={cancel}>{t('…cancel')}</Button>}
    primary={<Button type="submit" disabled={busy} aria-busy={busy}>{t('…save')}</Button>}
  />
</form>
```

- **Where.** Below 1024 px the bar is fixed to the bottom of the viewport (Fitts: where the thumb
  is), and the page pads itself so nothing hides under it. At ≥ 1024 px, `desktop="sticky"` makes it
  `position: sticky; bottom: 0`: in view while the form scrolls, settling at its end. Mount it as the
  **last child of the form or page wrapper it commits** — a sticky box cannot leave its parent — and
  **never inside a card or panel when it saves more than that panel** (Common Region). A Save that
  must sit outside its `<form>` submits it with `form={formId}` (the sales-channel editor draws the
  `sales_channel.editor.after` zone between its card and the bar this way). `desktop="inline"`, the
  default, is for a place that is already in view: a `PageHeader`'s `actions` (`SaveSessionActions`)
  or the product editor's sticky scope bar.
- **What.** `primary` is drawn last and `secondary` before it (Von Restorff, Jakob); on a phone both
  span the bar at 44 px. `note` is one muted line on what Save does, and is added to the primary's
  `aria-describedby`. `dirty` shows "Unsaved changes" (`core`'s `form.unsavedChanges.hint`).
  `error` and `status` say the last save's refusal and outcome **beside the button that caused
  them**, not in a banner at the top of the page (Proximity): each region exists once the prop is
  passed — `null` while there is nothing to say — mounted empty so the text that arrives is
  announced (WCAG 4.1.3); while there is an error the status is not shown.
- **What not.** A destructive action is not in the bar — it goes to the header or a menu, the form
  away from Save (Fitts). "Add line" and other list actions stay with their list. `children` remains
  the free layout of the callers that predate the slots; `.b2b-sticky-form-actions` is unlayered
  CSS, so a utility in `className` does not override its layout.

Adopted by the role editor, the profile, the promotion editor, RFQ Modify and RFQ create, the
sales-channel editor, and the task, opportunity, project and project-template forms. Pinned in
`admin/test/kit/kit-sticky-form-actions.test.tsx`, including an axe pass.

## A record's facts — `InlineEdit` and `InlineEditTitle`

Issue #1453 (UX audit 2026-11-17, DS-21; owner decision DEC-05). An operator moving from an
Opportunity to its Task and its Project met three ways of saving a fact: per field in CRM, one
*Edit* turning the whole Task block into a form, and three separate Saves on the Project Overview
(WORK-03, #1525). The record-editing model is CRM's, moved here: **each fact is edited where it is
shown**, with its own *Save* and *Cancel*, sending only itself.

```tsx
<InlineEdit<string>
  label={t('field.startOn')}
  canEdit={canWrite}
  display={startOn ? calendarDateLabel(startOn) : t('detail.noStartDate')}
  initial={() => startOn ?? ''}
  unchanged={(draft) => (draft || null) === startOn}
  validate={(draft) => (draft ? null : t('x.required'))}   // optional, before any request
  save={(draft) => update({ startOn: draft || null })}      // reject with Error(sentence) to refuse
  editor={({ id, draft, setDraft, busy, errorId }) => (
    <Input id={id} type="date" value={draft} disabled={busy}
      aria-invalid={errorId !== undefined} aria-describedby={errorId}
      onChange={(e) => setDraft(e.target.value)} />
  )}
/>
```

- **States.** Idle: the label, the value and an always-visible pencil named "Edit <label>" (44 px on
  touch). Editing: the focus moves into the control `id` names, Enter saves a one-line field
  (`submit` lets a formatted field save on Ctrl/Cmd + Enter), Escape cancels and returns the focus to
  the pencil. Saving: the control and buttons are held, *Save* is `aria-busy`. Refused: the sentence
  under the control as `role="alert"`, tied to it through `errorId`, the draft kept. Saved:
  "<label> saved." is announced by a live region mounted before it has text (WCAG 4.1.3).
- **`save` throws to refuse.** Its rejection's `message` is shown; one without a message shows
  `core`'s `common.inlineEdit.error`. Map an API error to a sentence in the module (the server's own
  sentence first) and rethrow it as `Error`.
- **`group`** for an editor of several controls — radios, a tag picker: the label is drawn with
  `labelId` for the group's `aria-labelledby`, instead of a `<label for>` that would name one radio
  only. Put `id` on the control the focus should land on (the checked radio). A control that is
  still disabled when the field opens — a picker reading its options — leaves the focus on the
  field's form, so the next Tab reaches it.
- **`labelVisible={false}`** where a section heading already names the field (the CRM description).
- **`InlineEditTitle`** is the same model for the page's `h1`: the `PageHeader` with a pencil beside
  the title; editing swaps the heading row for a large input (a visually hidden `h1` stays). It takes
  every `PageHeader` prop but `title`/`titleActions`, plus `value`, `label`, `canEdit`, `beside` (the
  status badge), `maxLength`, `validate` and `save`; the draft is trimmed before both.
- **What not.** A page-wide *Edit* that turns a block of facts into a form, and an always-open
  control with its own filled *Save* beside read-only facts. A switch that applies at once stays a
  switch; a record's custom fields keep `CustomFieldValuesPanel`'s one Save.

Adopted by the Opportunity (title, value, dates, contact, assignee, Sales Channel, description),
the Task (title, description, due date, start date, priority, tags, assignees) and the Project
Overview (description, start date, who sees it). Pinned in `admin/test/kit/kit-inline-edit.test.tsx`,
including axe passes, against the shipped `core` copy in English and Polish.

## List filters — `ListToolbar`, `ListToolbarSearch` and `FilterChip`

Issue #1440 (UX audit 2026-11-17, DS-06). `ListToolbar` (`./components`) is a list page's filter row,
extracted from the Orders list's toolbar and the Tasks list's *More filters (n)* disclosure (#512). A
page composes it. It is not a page shell, and it draws no card or border of its own.

```tsx
<ListToolbar
  label={t('orders.toolbar.label')}
  search={<ListToolbarSearch label={t('orders.field.search')} value={q} onValueChange={setQ} />}
  filters={<>{statusMultiSelect}{channelMultiSelect}{sortSelect}</>}
  actions={<SavedViewsControl … />}
  moreFilters={<>{/* labelled cells, laid out four to a row */}</>}
  moreFiltersActiveCount={hiddenInUse}
  appliedFilters={chips}
  onClearFilters={clearAll}
/>
```

- **Three or four primary filters**, and no more. Search, the filters operators use most, and the
  list's own controls (`actions`, pushed to the right) are always visible. The long tail goes in
  `moreFilters`, behind a **More filters** button. While the panel is closed the button shows
  **More filters (n)** from `moreFiltersActiveCount`, so a folded bar still tells the operator that
  the list is narrowed (Hick's Law). The page computes the count, and each value of a multi-valued
  filter may count as one.
- **The panel is always mounted** and `hidden` while closed, so the toggle's `aria-controls` always
  names an element. Its controls render only while it is open, so a filter that loads its own
  options does so only when the operator opens the panel.
- **Every control is labelled.** A primary filter takes `aria-label` (`Select`) or `ariaLabel`
  (`MultiSelect`). A cell in the panel takes a visible label: `<Label htmlFor>` for a native
  control, or a `<span id>` plus `ariaLabelledBy` for a `MultiSelect`. Never a `<label htmlFor>`
  pointing at an id that no control has. The placeholder is never the name, so
  `ListToolbarSearch` requires `label`.
- **Applied filters** (`appliedFilters`) are chips named by what pressing them does ("Remove
  filter: Status: Paid", or `removeLabel`), followed by **Clear all filters** when
  `onClearFilters` is given. The search box is not a chip, because it is always visible.
- The toolbar is a `search` landmark named by `label` ("Filter orders").
- **`FilterChip`** is a one-press toggle for an on/off filter ("Low stock"). It is a
  `<button type="button" aria-pressed>` in the theme's `b2b-filterchip` style, controlled through
  `pressed` and `onPressedChange(next)`. It has a 44 px hit area on a coarse pointer, and its icon
  is decorative. A filter with several values is a labelled `Select` or `MultiSelect`. A chip that
  steps to the next value on each press does not tell the operator what the next press will do.
- **No dead controls.** A chip or button that looks like a working filter must work like one. If
  the filter does not exist yet, leave the control out (CAT-02, #1455).

The behaviour is pinned in `admin/test/kit/kit-list-toolbar.test.tsx`, including an axe pass. The
screens that use it are the Orders, Products and Inventory lists.

### `ListToolbar` as the filter bar: `filters`, `moreFilters` and *Clear* without chips

Issue #1505 (UX audit 2026-11-17, WORK-05). The audit asked for a kit `FilterBar` with a `primary`
and a `more` slot. `ListToolbar` already is that bar: `filters` is the primary slot and
`moreFilters` is the more slot. No second primitive exists, so do not write one. The CRM board,
the opportunity list, the Projects list, and Tasks and My Tasks use it.

```tsx
<ListToolbar
  label={t('filter.toolbar')}
  search={<ListToolbarSearch ref={searchRef} label={t('list.search')} value={q} onValueChange={setQ} />}
  filters={<>{stateSelect}{assigneeSelect}<FilterChip …>{t('filter.overdue')}</FilterChip></>}
  actions={sortSelect}
  moreFilters={<>{/* labelled cells */}</>}
  moreFiltersActiveCount={hiddenFilterCount(filters)}
  filtersActive={hasFilters(filters)}
  onClearFilters={clear}
/>
```

- **`filtersActive`** is for a page that lists no `appliedFilters` chips. While it is true and
  `onClearFilters` is given, the filter row ends with **Clear all filters**. With chips, the button
  stays at the end of the chip row and the prop is not needed. Count the search as a filter here.
- **Focus.** After **Clear all filters**, focus moves to the toolbar's first enabled control, which
  is normally the search box, because the button goes away with the filters (WCAG 2.4.3). The
  *More filters* toggle is one button whose name changes, so it keeps focus as the panel opens and
  closes. In the tab order the panel comes after the row's `actions`.
- **The count is the page's.** Write it as a pure exported function beside the page's filter state,
  so it can be tested without rendering. Count each folded filter once, however many values it
  holds, and each custom-field filter once. Do not count a filter the request does not carry, such
  as a custom-field filter for a reader without `custom_fields:read`. Examples:
  `tasks/src/admin/lib/task-filters.ts` `hiddenFilterCount`, `crm/src/admin/lib/board-fields.ts`
  `hiddenBoardFilterCount`, `projects/src/admin/lib/list-filters.ts` `hiddenFilterCount`.
- **The panel's controls mount only while it is open.** Data that a closed panel still needs, such
  as the custom-field labels used to name a refused filter, is read by the page, not by a cell in
  the panel.

## List or board — `ViewModeToggle`

Issue #1558 (UX audit 2026-11-17, WORK-07). `ViewModeToggle` (`./components`) is the *List | Board*
switch of a screen that shows its records both ways, moved from Tasks so every such screen offers it the
same way (Jakob's Law). It sits first in the `PageHeader` actions.

```tsx
<PageHeader title={t('list.title')} actions={<><ViewModeToggle mode={mode} onChange={setMode} />{newButton}</>} />
```

- **Two toggle buttons in a named group** (`common.viewMode.label`), each with an icon and a word. The
  pressed one says which view is on screen by `aria-pressed` and its `secondary` fill, never by colour
  alone. `onChange` is not called for the view already on screen.
- **The screen keeps the choice.** Tasks remembers it per admin (`useListViewModePreference`). CRM keeps
  it in the address (`/crm/opportunities?view=board`), so both views share one address and its filters.

## Menus — `DropdownMenu`, and a pick-one menu with `DropdownMenuRadioItem`

Issue #1783. Every admin menu is the portalled Radix `DropdownMenu` (`./ui`), so it is never clipped
and keeps one keyboard contract: focus moves into the menu when it opens, arrow keys and Home/End
walk its entries, typing jumps to an entry, Escape closes it and gives focus back to the trigger.
Do not hand-roll a `role="menu"` panel. The top bar's notification bell and language picker use it.

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild><button aria-label={t('appShell.languageIndicator.label')}>…</button></DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuRadioGroup value={language} onValueChange={pick}>
      <DropdownMenuRadioItem value="en" textValue={t('…option.en')}>🇬🇧 EN English</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  </DropdownMenuContent>
</DropdownMenu>
```

- **`DropdownMenuRadioItem`** is a `menuitemradio` whose `aria-checked` follows the group's `value`.
  Its check mark is hidden from assistive technology, which hears the checked state instead. Pass
  `textValue` when the entry's text does not start with the word a user would type, for example
  after a flag or a code.
- **`DropdownMenuLabel`** is a heading inside the panel. Point the content's `aria-labelledby` at it
  when the trigger's own name would be a poor name for the menu, for example a count.
- **Tests open a menu with `pointerdown`**, not `click`:
  `fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })`, or `userEvent.click`. While a modal
  menu is open the rest of the page is hidden from the accessibility tree, so query the trigger with
  `{ hidden: true }`.

## A list the server orders — `useServerReorder` and `ReorderControls`

Issue #1633, extracted from CRM and Tasks (#1560). For a configuration list whose order the server
keeps and changes in one batch (`PUT …/order` with the whole list): the CRM workflow statuses, the
Tasks statuses and priorities. A list ordered only on the client uses `useReorderList` instead.

```tsx
const reorder = useServerReorder({
  rows: ordered, // { code, weight } rows, in list order
  show: setRows,
  save: async (orderedCodes) => setRows(await api.reorder(orderedCodes)),
  reload: async () => setRows(await api.list()),
  staleMessage: t('reorder.stale'),
  failedMessage: (error) => errorMessage(error, t('reorder.failed')),
});
// per row:
<ReorderControls name={row.name} isFirst={i === 0} isLast={i === rows.length - 1}
  disabled={reorder.busy} onMove={(delta) => reorder.move(row.code, delta)} />
```

- **The row moves at once.** Weights are rewritten in steps of ten, so a table sorted by weight shows
  the move before the server answers. One save carries the whole list.
- **A refusal puts the list back** and sets `notice` to `{ kind: 'failed' }`. A 409 `ORDER_STALE` (the
  list changed under the operator) reloads it and sets `{ kind: 'stale' }`. The screen shows `notice`
  in an `Alert` beside the table.
- **One move at a time.** `busy` is true while a save is in flight, and `move` ignores calls until it
  settles. `ReorderControls` then sets `aria-disabled` rather than `disabled`, so the focus stays on
  the button as the row moves under it.
- The controls are `TouchReorderButtons` on a touch screen and two arrow buttons on a pointer screen.
  Their names are `core` copy that names the row (`reorder.moveRowUp`, `reorder.moveRowDown`).

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
  opens above the dialog) or `overlay` (`MODAL_OVERLAY_Z_INDEX`, above the fullscreen Page Builder,
  its 9999 floating action bar and the rich-text editor's own dialogs), for a dialog opened from
  inside the builder — every Page Builder, e-mail builder and translate dialog uses it (#1493).
  `ConfirmDialog` takes the same `layer` prop, and `useConfirmDialog({ layer: 'overlay' })` opens
  every question the screen asks on that layer. The Page Builder's *Clear canvas* question uses it.
  The default is `page`.
- `placement` — `center` (default) or `end`, a full-height panel docked to the inline end: a side
  drawer for a meta view opened over an editor, e.g. the product editor's Scope map (#1510). Same
  modal semantics; give it a `widthClassName` such as `max-w-3xl` and a Close button in `footer`.

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

**Focus after a confirmed removal.** A dialog returns focus to its opener. When the confirmed
action removes the opener (a row's *Remove*), focus would fall to `body` once the row is gone.
Pass `returnFocusTo` to `useConfirmDialog`'s `confirm` to send it to a neighbour instead (WCAG
2.4.3). It takes an element, a ref, or a resolver. It is resolved once, when the dialog closes
on a confirmed answer (with an `action`, after it succeeded), and the removed row is still on
screen at that moment. So name an element that outlives it, such as the next row or the
section's *Add*. On Cancel, or when the target resolves to nothing, focus returns to the opener.

```tsx
await confirm({ message, destructive: true, action, describeError, returnFocusTo: () => nextRowEdit(member) });
```

## List pages — `ListPage` and `useListPagination`

Issue #1439 (UX audit 2026-11-17, DS-05). An admin list came in several shapes: a create form drawn
open above the rows, the filters in a card of their own, a red *Delete* in every row, and on
Customers, Organizations and Carts no pager at all (#1473) — the API paged and the screen showed
page one. Every list is now the same page:

| Part | What it is | Why |
| --- | --- | --- |
| Header | `PageHeader` with **one** primary *New …* in `actions`, and at most a `RowActionMenu` beside it for screen-wide secondary actions | One primary per view (Von Restorff); the create action where every admin looks for it (Jakob) |
| Create / edit | *New …* opens a `ModalDialog` when the form has up to five fields, its own route otherwise — never a form drawn open above the list | A form always open competes with the list it sits on (Hick) |
| Toolbar | A plain row of labelled filters and the search, **not a card**; the result count at its end in a live region | A card around the toolbar reads as a second region (Common Region); the count is announced as it changes (WCAG 4.1.3) |
| Results | One `ResponsiveTable` in one card; the record's name in the primary column **is the link** to it | No *Open* button repeating the name in every row (signal-to-noise) |
| Row actions | `RowActionMenu`; destructive items last, after a `RowActionMenuSeparator`, and each confirmed through `useConfirmDialog` (`action` + `describeError`, so the request runs inside the dialog) | Destructive actions get distance, not a button in every row (Fitts) |
| Pager | `PaginationFooter` under the table, fed by `useListPagination` — or `useCursorPagination` for a cursor-paged endpoint with no total | Every row reachable without a search |
| States | Loading (a skeleton, `aria-busy`, *Loading…* through the count's live region), an error with the server's message or the kit's, and *Retry*; *no records yet* distinct from *no record matches — Clear filters* | A list that fails or comes back empty still says what to do next |

```tsx
const pager = useListPagination({ scope: 'customers', maxPageSize: 100 });
// request: { ...filters, ...pager.query }  → page is one-based
// on success: pager.syncTotal(total); on a filter change: pager.resetPage()
<ListPage
  title={t('list.title')}
  actions={<Button asChild><Link to="/x/new"><Plus aria-hidden="true" />{t('list.create')}</Link></Button>}
  toolbar={<>{search}{statusSelect}</>}
  count={t('list.count', { count: total })}
  load={load}                       // { kind: 'loading' } | { kind: 'error', message? } | { kind: 'ready' }
  onRetry={reload}
  pagination={pager.footer(total)}
>
  <ResponsiveTable columns={columns} data={rows} keyExtractor={(r) => r.id} emptyState={empty} renderActions={menu} />
</ListPage>
```

- **`useListPagination` offers only the page sizes the endpoint serves.** The shared options run to
  500 and most admin list endpoints stop at 100 or 200; `pageSizesUpTo(maxPageSize)` drops the rest,
  and `fitPageSize` reads a remembered 500 as the largest size offered, leaving the stored
  preference alone for the lists that do serve it. The size is the admin's per-list preference
  (`usePageSizePreference(scope)`), so the hook needs `AuthProvider` above it, as every screen has.
- **`syncTotal(total)`** moves back to the last page that exists when a response says the list has
  shrunk under the current page — after the last rows were deleted, or another operator's change.
- **Server-side paging only.** A list whose endpoint does not page gets `page` / `pageSize` and a
  total in its contract first (`packages/contracts`), as the Organizations list did in #1473; paging
  a fetched-whole array in the browser is not this pattern.
- **What the kit deliberately leaves to the screen:** the filters themselves and their "More
  filters" disclosure (DS-06, #1440, the kit `ListToolbar`), and the empty state's icon and copy
  (DS-15, #1448, the kit `EmptyState`). Both slot into `toolbar` and `emptyState` when they land.
- **`help`** goes to `PageHeader`'s ⓘ, for a list whose header needs a longer explanation than a
  one-line `description` (the Modules screen, #1520).
- **A refresh over rows on screen is `busy`, not `loading`** (issue #1749). `load: { kind: 'loading' }`
  draws the skeleton, which is for the first load only; a filter change, a save or a poll that keeps
  the rows passes `busy` instead — the results region is `aria-busy` and the count's live region says
  *Loading…* (ux-laws §6.1). **`resultsRef`** hands the screen the results region (`tabIndex={-1}`), for
  a screen that sends focus to the results — after removing a refused filter (WCAG 2.4.3). An error a
  retry cannot fix carries its own way out, `{ kind: 'error', message, action }`, shown in place of
  *Retry* — the Tasks, Projects and Opportunities lists' *Remove filter*. Pinned in
  `admin/test/kit/kit-list-page-refresh.test.tsx`. `ResponsiveTable`'s `label` names the table where
  the heading alone does not say what it lists (the settings lists under their configuration tabs).
- **A list with row selection** passes `ResponsiveTable` `isRowSelected` (issue #1749): the selected
  rows, and the cards on a phone, carry `data-state="selected"` and draw in the kit's selected tint.
  The checked checkbox stays the sign; the tint only groups the selection (never colour alone). Give
  the select column `primary`, so a phone's card keeps the checkbox beside the name. Pinned in
  `admin/test/kit/kit-responsive-table-selected.test.tsx`; the products list is the first adopter.
- Pinned in `admin/test/kit/kit-list-page.test.tsx`, including an axe pass; the three first
  adopters are `CustomersList`, `OrganizationsList` and `CartsList`.
- **A value edited from the row** (issue #1501, SHELL-14) is a `StatusChangeControl` with
  `labelVisuallyHidden`, not a `<select>` that saves on `change`: the column header already names
  it, so the label stays the button's accessible name without being drawn on every row. The Users
  list's role column is the first; the five SHELL-14 lists (Users, API keys, Webhooks, Taxes,
  Setting groups) are the pattern's next adopters, API keys and Webhooks with their create form on
  a `/new` route because it ends on a one-time secret.
- **The sales lists** (issue #1500, SALES-24) compose the two. `toolbar` takes a
  `<ListToolbar className="min-w-0 flex-1" …>`, so the toolbar keeps its `search` landmark and the
  result count still ends the row. A bulk bar is the results card's header row, so it goes in
  `notice`, not in a card of its own. The empty state follows the rows on screen: choose
  `no-results` from the filters the request carried (the debounced search), not from the text still
  being typed. A row gets a `RowActionMenu` only when it can do something besides open, and it links
  to another module's screen only when its module depends on that one. Orders, Quote Requests,
  Returns, Customers, Organizations and Carts follow this.

### Cursor-paged lists — `useCursorPagination`

Issue #1664. An endpoint that pages by an opaque cursor (`{ cursor, hasMore, limit }`, the
invoices list since #1120) answers no total, so `useListPagination` would have to be fed an
invented one. `useCursorPagination` is its counterpart, and `ListPage` draws the same
`PaginationFooter` for it, in cursor mode — the same place, the same buttons, the same rows-per-page
dropdown as every other list:

```tsx
const pager = useCursorPagination({ scope: 'invoices', maxPageSize: 200 });
// request: { ...filters, cursor: pager.query.cursor, limit: pager.query.limit }
// on success: pager.syncPage(res.pagination, res.data.length); on a filter change: pager.resetPage()
<ListPage … pagination={pager.footer(rows.length)}>…</ListPage>
```

- **What it shows.** *Showing 21–40 of more than 40* while the server says a next page exists,
  *Showing 41–45* on the last one, and *Page N* — never *of Z* or *Page N of M*, which the server
  cannot answer.
- **Previous walks back the cursors already followed**, so it works over a forward-only endpoint.
  *Next* spends the next cursor in the same update, so a second press before the page answers
  cannot skip one.
- **`syncPage`** keeps the next cursor, and steps back one page when a later page comes back
  empty (its rows were deleted after the previous page said more existed).
- The remembered page size is the same per-`scope` preference as `useListPagination`, fitted to
  `maxPageSize` the same way; a size change goes back to the first page.
- `ListPage`'s **`tabs`** slot holds section tabs (`RouteTabs`) between the header and the
  toolbar, for a list that is one of a module's sections — Invoices beside its templates.
- `CursorPagination` (record history) stays for cursor lists that are not a `ListPage`. Pinned in
  `admin/test/kit/kit-list-page.test.tsx`; the first adopter is `InvoicesList`.
- The **`tabs`** slot is the band between the header and the toolbar: section tabs, or what a list
  shows above its filters — the inventory list's KPI strip (#1749).

### Search as you type — `useDebouncedValue`

Issue #1495 (UX audit CONTENT-13). A list's search runs while the operator types, never only on
Enter or behind a *Search* button (Doherty). One request goes out per pause, not one per keystroke.
The box shows what was typed, and the request reads the debounced value:

```tsx
const [q, setQ] = useState('');
const query = useDebouncedValue(q.trim());        // SEARCH_DEBOUNCE_MS = 300 by default
useEffect(() => { /* load with `query` */ }, [query]);
<ListToolbarSearch label={t('list.search')} value={q} onValueChange={setQ} />
```

- The first render returns the value at once, so the list loads without waiting. Each later change
  restarts the wait.
- Decide "nothing matches" from `query`, the value that produced the rows, not from `q`.
- Pinned in `admin/test/kit/kit-use-debounced-value.test.tsx`. Used by the CMS page list and the
  blog post and tag lists.

### Focus after a row is deleted — `useRemovalFocus`

Issue #1495 (UX audit CONTENT-13, WCAG 2.4.3). A row's *Delete* is opened from the row's own
menu, and the menu goes with the row, so focus would otherwise fall to `<body>`.
`useRemovalFocus(rows, idOf, ready)` gives `useConfirmDialog` a `returnFocusTo` that points at
the next row, else the previous one. When no row is left, it focuses the list's create action
once the list has rendered empty:

```tsx
const removalFocus = useRemovalFocus(rows, rowId, load.kind === 'ready'); // rowId: stable, module-level
<Link ref={removalFocus.targetRef(row)} to={`/x/${row.id}`}>{row.name}</Link>
<Link ref={(el) => { removalFocus.createRef.current = el; }} to="/x/new">…</Link>
await confirm({ …, action, describeError, returnFocusTo: removalFocus.returnFocusTo(row) });
```

- Remove the deleted row from the rows **in place** rather than reloading the list. A reload
  unmounts every row behind the skeleton, including the one that just took focus.
- The create action is the empty state's own *New …* by the time it is focused, because the
  header's goes away with the last row. Pass the same `createRef` to whichever is drawn.
- Used by the CMS, blog and megamenu lists, and pinned in their tests.

## Board cards — `BoardCardFieldsEditor`

Issue #1506 (UX audit 2026-11-17, WORK-15). It edits which fields a board card shows and in what order. CRM and
Tasks used to keep their own copies, and a fix to one (#512) had to be ported to the other by hand.

```tsx
<BoardCardFieldsEditor
  load={(): Promise<TaskBoardCardConfig> => tasksApi.boardCardFields()}
  save={(refs): Promise<TaskBoardCardConfig> => tasksApi.setBoardCardFields(refs)}
  fieldLabel={(field): string => boardFieldLabel(field, language, t)}
  copy={{
    titleAlways: t('boardCard.shown.titleAlways'),
    builtinGroup: t('boardCard.available.builtin'),
    noCustom: t('boardCard.available.noCustom'),
  }}
/>
```

- **The catalogue and the limit come from `load`.** `load` and `save` both return
  `{ fields, available, maxFields }`: the stored choice in order, every field that can be chosen,
  and the most a card shows. This is the shape both modules' endpoints already return. The server owns
  the limit and rejects a choice over it, so the limit is not a separate prop. A field only needs
  `ref` and `source` (`'builtin' | 'custom'`), which decides its group.
- **Copy.** `copy` holds the three lines that name the module's record: the built-in group's
  heading, the line under *Shown on the card*, and where custom fields are defined. Everything else
  comes from `core`'s `boardCardFields.*` keys.
- **The order is set with buttons**, *Move up* / *Move down*, not by dragging (WCAG 2.2 SC 2.5.7).
  Before the limit is reached, the count says how many of how many are used. Once the card is full,
  every *Add* is disabled and a line says why.
- **Focus stays on the field being worked on** (WCAG 2.4.3):
  - after a move, it lands on the moved row's control in that direction, or the other control if
    the row reached an end;
  - after a removal, it lands on the row that took its place, or on the field's own *Add* when no
    row is left;
  - after an add, it lands on the next field offered in the same group, or on the added row once
    the card is full.
- **Nothing is stored until *Save*.** *Discard changes* goes back to the stored choice. Leaving
  through a link with unsaved changes asks first (`useUnsavedChangesPrompt`). After a save, the
  lists show the server's answer. If the server refuses the save, its own sentence is shown and the
  edit is kept. If the first read fails, a retry is offered.
- The caller supplies the card around it (a `Card` with the section title).

Pinned in `admin/test/kit/kit-board-card-fields.test.tsx`. Each module's endpoint and copy are
pinned in its configuration screen's test.

## Dates — `formatDate` and `formatDateTime`

Every admin date is written one way, in the admin UI language — pass `useAppLanguage().language`
(or `useTranslationContext().language`, the same value), never rely on the browser's locale (#1567: one sidebar showed `17.11.2026`, `11/25/2026` and
`Nov 22, 2026` side by side).

- `formatDate(value, language)` — the language's medium date (*Nov 25, 2026*, *25 lis 2026*). A
  `YYYY-MM-DD` calendar date is read without a time-zone shift; an ISO instant gives its day.
- `formatDateTime(iso, language)` — that date and the short time, never seconds.
- Both write `—` for nothing and give back what is not a date.
- Always pass the language. The one-argument form is **deprecated** (#1776): it still falls back to
  the browser's locale for consumers outside this repository, and will be removed in a later
  release. Inside the repository `admin/test/unit/no-browser-locale-dates.test.ts` refuses it, as
  well as `toLocaleDateString` / `toLocaleTimeString` in admin code and any `toLocaleString` call
  not listed there as a number.
