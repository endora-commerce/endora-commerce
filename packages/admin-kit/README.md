# `@endora-commerce/admin-kit`

The admin surface a module package's `./admin` layer is written against
(feature 091, `specs/091-module-owned-admin-surfaces/`).

## What it publishes

Five subpaths, each an explicit barrel, all resolving at `./dist`:

| Subpath | What it is |
| --- | --- |
| `./ui` | the shadcn/Radix primitives — `button`, `alert`, `card`, `page-header`, `input`, `label`, `select`, `badge`, `table`, `checkbox`, `textarea`, `multi-select`, `combobox`, `save-button-group`, `color-picker`, `route-tabs`, `separator` |
| `./components` | the composites — `ResponsiveTable`, `PaginationFooter`, `RuleBuilder`, `StickyFormActions`, `TouchReorderButtons`, `<EChart>`, the pickers, the reorder helpers |
| `./lib` | `apiClient`, `format`, `money`, `utils` (`cn`), `text-normalization` (the one `foldDiacritics` / `slugify` owner), `uuid`, the unsaved-changes prompt, the icon map, the page-size options — and, since P3, the **session cluster**: `AuthProvider` / `useAuth`, `ModulePresenceProvider` / `useModulePresence`, `useSurfaceVisibility` and `usePageSizePreference` |
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
rather than by structure: `admin/test/kit/admin-kit-identity.test.ts` compares the binding
reached through a shim with the binding reached through the barrel using `toBe`, for a
function, a component, the API-client singleton, the `ApiError` class (`instanceof`) and a
React context. A second `createContext()` passes every structural comparison and is a
`null` context at runtime with no type error; that is the failure this file exists to make
impossible.

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

`asset-picker` is left, and for a reason of kind rather than of size: its module knowledge
is `assets_library`' `AssetPicker` **component**, which no URL replaces. It is FR-007's
worked example and **retires with P4**. Inverting the pickers to take their data by prop
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
with `useAuth must be used inside <AuthProvider>`. They drive the real providers now, seeded
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
split has nothing left to separate — both halves are here and the shim forwards both.

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

The limit is stated so it is not discovered later: a picker whose module knowledge is a
**component** has nothing to rebuild. `asset-picker` renders `assets_library`' own
`AssetPicker`, so it stays unpublished until P4's zone mechanism exists.

## Rules

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

## Known rough edge

`./i18n` publishes `resolve` (the translation resolver) under that bare name, because it
is the name every existing caller and both of its tests already use and this merge request
is a move. It is a poor name on a public barrel and renaming it is a `major` under R12 —
worth doing before the first package is published, not inside a change whose subject is a
file relocation.
