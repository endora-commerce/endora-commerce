# `@endora-commerce/admin-kit`

The admin surface a module package's `./admin` layer is written against
(feature 091, `specs/091-module-owned-admin-surfaces/`).

## What it publishes

Five subpaths, each an explicit barrel, all resolving at `./dist`:

| Subpath | What it is |
| --- | --- |
| `./ui` | the shadcn/Radix primitives — `button`, `alert`, `card`, `page-header` (`PageHeader`, see below), `input`, `label`, `form-field` (`FormField`, see below), `help-tip` (`HelpTip`), `switch` (`Switch`, see below), `setting-row` (`SettingRow`), `inline-status` (`InlineStatus`, `useInlineStatus`, see below), `empty-state` (`EmptyState`, see below), `select`, `badge`, `table`, `checkbox`, `textarea`, `multi-select`, `combobox`, `save-button-group`, `color-picker`, `route-tabs`, `tabs` (`Tabs`, `TabPanel`, `RecordTabs`, see below), `editor-section` (`EditorSection`, see below), `separator` |
| `./components` | the composites — `ResponsiveTable`, `PaginationFooter`, `ListToolbar` with `ListToolbarSearch` and `FilterChip` (see below), `RowActionMenu`, `DetailHeaderActions` (see below), `RuleBuilder`, `StickyFormActions`, `TouchReorderButtons`, `<EChart>` with `useChartColors` and `prefersReducedMotion`, the analytics figure frame `FigureCard` with `useFigure`, `ModalDialog`, `SavedViewsControl`, `CustomFieldListFilters` with `useCustomFieldListFilterFields` and its helpers (`readCustomFieldFilterParams`, `writeCustomFieldFilterParams`, `sanitizeCustomFieldFilters`, `pruneRemovedOptions`, `customFieldFilterChips`, `customFieldFilterRefusal`, `toCustomFieldFiltersParam`, `customFieldDisplayName`, `resolveCustomFieldLabel`, `emptyCustomFieldFilters`, `withCustomFieldFilter`, `withoutCustomFieldFilter`), the pickers, the reorder helpers |
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

The behaviour is pinned in `admin/test/kit/kit-form-field.test.tsx`, including an axe pass;
`ScopedField`'s `help` in `admin/test/kit/kit-scoped-field.test.tsx`.

## Page headers — `PageHeader`

Issue #1436 (UX audit 2026-11-17, DS-02). Every admin page draws its one `h1` through
`PageHeader`; the `.b2b-page-head` classes that drew a title as a `<div>` are gone from
`theme.css`.

```tsx
<PageHeader
  back={{ label: t('list.back'), to: '/warehouses' }}
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

`.b2b-card` and its `__head` / `__title` / `__sub` / `__body` / `__body--flush` / `__foot` /
`--clickable` classes are **deprecated** and still published (D-219): they read the same tokens,
so the two look alike while the call sites move. Do not add new ones. The behaviour is pinned in
`admin/test/kit/kit-card.test.tsx`, which also refuses a `CardContent` with `pt-6` and a
`CardTitle` wrapping its own heading.

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
  by default and take `chrome="card"`. `CustomFieldValuesPanel` also takes `titleAs`. History and
  comments render no heading of their own as a section: the host's tab or heading names them.
- Mount a zone at page level, between the host's own cards, as `<AdminZone … chrome="card" />`;
  inside a card, leave the prop off. A contribution that renders an `EditorSection` follows the
  mount, so the same panel is right in both places.
- A list of items inside a section is rows divided by a rule — `divide-y divide-border` on the
  list, `py-3 first:pt-0 last:pb-0` on the item — not a `rounded-md border` box per item.

**Breaking, visually, for a third-party module** (0.x, so a `minor`): a panel that mounted
`CustomFieldValuesPanel`, `RecordHistory` or `CommentThread` on its own, outside a card, now gets
no card; pass `chrome="card"` to keep it.

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
- `icon` is decorative (`aria-hidden`). The panel is focusable (`tabIndex` 0) unless the screen
  passes `-1` because it only focuses the panel programmatically.
- **No tabs inside tabs.** A second level inside a panel hides content two clicks deep and gives
  the keyboard two strips with the same keys: make the second level `Section`s. In development a
  `Tabs` rendered inside a `TabPanel` logs a warning; a `ModalDialog` opened from a panel is a new
  context and does not.

The behaviour is pinned in `admin/test/kit/kit-tabs.test.tsx`, including the keyboard path and an
axe pass.

## Empty lists — `EmptyState`

Issue #1448 (UX audit 2026-11-17, DS-15). What a list, a tab or a panel shows when it has
nothing to show: a decorative icon, a title, at most one line and at most one action — never a
bare grey sentence (Picture Superiority). It draws the `.b2b-empty` classes, so do not write
them out by hand. Two variants, because "nothing here yet" and "your filters match nothing" call
for different next steps:

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
  `ImmediateBadge`.
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

The component is pinned in `admin/test/kit/kit-detail-header-actions.test.tsx`, including an axe pass
closed and open. The rule is also § Von Restorff of `.claude/skills/ux-laws/SKILL.md`.

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
| Pager | `PaginationFooter` under the table, fed by `useListPagination` | Every row reachable without a search |
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
- Pinned in `admin/test/kit/kit-list-page.test.tsx`, including an axe pass; the three first
  adopters are `CustomersList`, `OrganizationsList` and `CartsList`.
