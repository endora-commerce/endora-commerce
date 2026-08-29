# `@endora-commerce/admin-kit`

The admin surface a module package's `./admin` layer is written against
(feature 091, `specs/091-module-owned-admin-surfaces/`).

## What it publishes today

One subpath, `./contributions`: the declaration types a module's
`src/admin/index.ts` exports — routes, sidebar entries and zone contributions —
re-exported from `@endora-commerce/contracts` so a module needs one import for
the shapes and not two.

## What it does not publish yet, and the measurement that decided it

`specs/091-module-owned-admin-surfaces/contracts/admin-kit-surface.md` §2
derives four more subpaths from what module code actually reaches for:

| Subpath | Distinct host modules | Sites |
| --- | --- | --- |
| `./ui` | 17 | 1106 |
| `./lib` | 12 | 342 |
| `./i18n` | 5 | 218 |
| `./components` | 28 | 96 |

Those numbers were re-measured on 2026-08-29 and every one of them is right —
1762 host reaches over 62 distinct modules, from 289 of the 327 files under
`admin/src/modules`, with `button` (185), `alert` (160) and `card` (141) at the
top. What is **wrong** is R4's mechanism: *"the kit re-exports the
implementations that live in `admin/src/…`; no admin file moves when the kit
lands."*

**That cannot be built.** A re-export escaping the package is an input to `tsc`
outside `rootDir`, which is TS6059 — the same trap AGENTS.md records for an
active `paths` block, and which exits 2 *and* emits the target's output beside
its own source. Measured, on a two-file probe re-exporting one component:

```
src/ui/index.ts(1,24): error TS6059: File 'admin/src/components/ui/button.tsx'
  is not under 'rootDir' '…/src'. 'rootDir' is expected to contain all source files.
admin/src/components/ui/button.tsx(4,20): error TS2307: Cannot find module '@/lib/utils'
```

The second line is the independent half of the same answer: an admin source
file resolves its own imports through the `@/*` alias in `admin/tsconfig.json`,
so it does not compile in any program but the admin's. Dropping `rootDir` makes
it compile and emits a **second copy** of the component into the kit's `dist` —
a duplicated module-scope value in a tree full of React context, which is the
defect `check:singleton-identity` refuses on the backend and which has no
frontend instrument at all. Shipping no `dist` is not open either: this
repository's packages resolve at `./dist` (D-164) and
`backend/test/unit/packages/package-dist-build.test.ts` compiles every
package's emitted output in a NodeNext consumer.

So the buildable shape is the one feature 080 already used for the platform
relocation: **the implementations move into this package and `admin/src` keeps
one-line re-export shims at their old paths**, which leaves all 1762 existing
`@/…` reaches working unchanged and gives every binding exactly one home. That
is a different merge request from this one, and it is Phase 1b.

## One finding Phase 1b has to answer first

Six members of the derived `./components` set reach **back into module
directories**, so moving them as they stand would make the kit depend on module
code and break R6 (*"the kit holds no module knowledge"*):

| Kit candidate | Reaches |
| --- | --- |
| `components/cms-picker/CmsBlockPicker.tsx` | `modules/cms/api/cms-client` |
| `components/cms-picker/CmsPagePicker.tsx` | `modules/cms/api/cms-client` |
| `components/organization-picker/*` (4 files) | `modules/organizations/api/organizations-picker-client` |
| `components/asset-picker/AssetFieldPicker.tsx` | `modules/assets_library/{components/AssetPicker,api/assets-library-client}` |
| `components/sales-channel-picker/SalesChannelPicker.tsx` | `modules/sales_channels/api/sales-channels-client` |

The transitive closure of the whole derived surface inside `admin/src` is **74
files**, so the move itself is small; these six are the only ones that need a
decision rather than a `git mv`. They are also exactly the shape FR-007 exists
for — a picker over another module's data is that module's contribution, not
the platform's.

## Rules that already apply

- **Every dependency the kit renders with is a `peerDependency`** so the
  application resolves one copy (R7). Two copies of `react-router-dom` is two
  router contexts and a `useNavigate()` that throws; two copies of `react` is
  hooks that fail at runtime with no type error.
- **No wildcard subpath** (R1) and **no `export *` in a barrel** (R2).
- **No root export** (R3): a consumer names the group it wants, so a reach is
  legible in the import line.
- **The kit adds no component** (R5): a component that exists only here is one
  the admin application does not use, which is how a design system acquires two
  answers to one question. New pieces go into the admin first and are published
  in the same merge request.
- **Both `tsconfig.base.json` `paths` entries are written, and the bare one names a
  file this package deliberately does not have.** R3 gives the kit no root
  export, so a consumer names the group it wants. The pair is written anyway
  because `workspace-resolution.test.ts` requires both or neither — one of the
  two is still a capture — and the missing target fails closed: `tsc` falls
  through to node resolution, which the `exports` map refuses for `.` exactly as
  it should. (The reason lives here rather than beside the entry because that
  test reads `tsconfig.base.json` with `JSON.parse`, which rejects a comment.)
- **This package carries no `endora` block**, and that is load-bearing:
  `backend/test/unit/harness/workspace-resolution.test.ts` reads that block to
  decide which members are *refused* a `tsconfig.base.json` `paths` entry. The
  kit is a library the admin and a module's admin layer resolve, not a member
  the platform composes, so it takes both entries.
