# `@endora-commerce/admin-kit`

The admin surface a module package's `./admin` layer is written against
(feature 091, `specs/091-module-owned-admin-surfaces/`).

## What it publishes

Five subpaths, each an explicit barrel, all resolving at `./dist`:

| Subpath | What it is |
| --- | --- |
| `./ui` | the shadcn/Radix primitives — `button`, `alert`, `card`, `page-header`, `input`, `label`, `select`, `badge`, `table`, `checkbox`, `textarea`, `multi-select`, `combobox`, `save-button-group`, `color-picker`, `route-tabs`, `separator` |
| `./components` | the composites — `ResponsiveTable`, `PaginationFooter`, `RuleBuilder`, `StickyFormActions`, `TouchReorderButtons`, `<EChart>`, the generic pickers, the reorder helpers |
| `./lib` | `apiClient`, `format`, `money`, `utils` (`cn`), `text-normalization` (the one `foldDiacritics` / `slugify` owner), `uuid`, the unsaved-changes prompt, the icon map, the page-size options |
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

## What Phase 1b does not publish, and why

Two groups, 92 reaches, every one of them in `backend/scripts/ledgers/admin-surface.ts`
with its retiring condition. `check:admin-surface` holds the ledger both ways, so neither
group can grow quietly and neither can be left behind once it is repaired.

**The six pickers (19 reaches).** `organization-picker`, `sales-channel-picker`,
`asset-picker` and `cms-picker` each fetch from **another module's** API client, so
publishing them would put module knowledge in the kit and break R6. They are FR-007's own
worked example — a picker over another module's data is that module's contribution, not
the platform's. **Retires with Phase 2**, when a module package can ship an `./admin`
layer and contribute the picker to a zone. Inverting them to take their data by prop was
considered and rejected: it rewrites six public component APIs and fifteen consumers in a
merge request whose subject is a file move, and it is work Phase 2 would then undo.

**The admin's session and module-presence state (73 reaches).** `lib/auth`,
`lib/module-presence`, `lib/surface-visibility`, `lib/use-page-size-preference` and the two
tab components that read presence. This one is not a design question — it is a
measurement. 23 of the admin's test files mock those modules **at the module path**, on
purpose: `TaxesPage.permission-gating.test.tsx` says so in its own comment, *"the mocks
stop at `useAuth` and `useModulePresence` deliberately, so the real `useSurfaceVisibility`
is the thing under test rather than a stub of it."* `vi.mock` keys on a module id, so
moving `surface-visibility` into this package alongside `auth` puts that seam **inside**
the package where the test's mock cannot reach it: measured, **104 tests across 23 files**,
every one of them a permission gate. **Retires when those tests drive the real providers
instead of replacing the modules** — a better test either way, and its own merge request.

`PAGE_SIZE_OPTIONS` is the one binding that was split out of a module that stayed behind:
the **constant** is design-system and the **preference** is application state, so the
constant lives here and `usePageSizePreference` re-exports it. One array, two homes for the
two things it was doing.

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
