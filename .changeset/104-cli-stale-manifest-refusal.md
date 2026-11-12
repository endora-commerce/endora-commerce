---
'@endora-commerce/cli': patch
---

`requireModuleLayout` (`@endora-commerce/cli/lib/module-roots.js`) now refuses with exit 2 when a module package's emitted manifest is older than its `src/manifest.ts` (issue #104). The layout is read out of the generated manifest index, which imports every package's built manifest, so a check resolving it without a rebuild answered about the previous build; six checks called `refuseStaleEmittedArtefacts` themselves and the rest did not. Every check that resolves the module layout now inherits the refusal, which names the stale package and asks for `pnpm run build:packages`. A caller that resolves the layout with `resolveModuleLayout` directly is unchanged.
