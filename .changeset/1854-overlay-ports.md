---
'@endora-commerce/cli': minor
---

Overlay modules can publish port types to each other, and the CLI holds the one import that may
cross between them (issue #1854, `specs/190-overlay-full-modules/` FR-059, FR-070 – FR-072).

- **`endora new module --ports`** now works inside an instance. It writes `ports.ts`, holding the
  port interface `<Pascal>ReadPort`, and a `ctx.di.providePort('<camel>ReadPort', …)` call in
  `backend.ts`. The next steps say how a sibling overlay module consumes it and name the
  `port-provided` reason the published port needs in `divergence.ts`.
- **`endora generate` reports the overlay boundary.** An overlay module may import another
  overlay module only with `import type`, only from its `ports.ts`, only in the same deployment,
  and only when its manifest `dependencies` name that module (transitively). Every other import
  between two overlay modules is printed as `[overlay-boundary]` with each clause it fails. The
  run then exits 1, after writing its artefacts, as it does for a divergence finding.
  `GenerateResult` gains `overlayBoundary`.
- **A port consumed from a sibling overlay module is not a divergence.** The report no longer
  records a `port-consumed` entry for it, and asks for no reason; the provider's `port-provided`
  entry stays. The report's `notRecorded` boundary names it. After upgrading, run
  `endora generate` to re-render `divergence.generated.md` and `.json`, and delete a
  `port-consumed:<module>:<port>` reason for such a port, which the report now flags as describing
  no divergence.
- **API.** `@endora-commerce/cli/lib/overlay-boundary.js` is new. It exports
  `analyzeOverlayBoundary`, `analyzeOverlaySource`, `overlayEdgeOf`, `overlayBoundaryInputUnder`,
  `overlayDependenciesOf`, `readManifestDependencies`, `overlayModuleOf`,
  `describeOverlayBoundaryFinding` and `OVERLAY_BOUNDARY_CLAUSES`, with the types
  `OverlayBoundaryClause`, `OverlayBoundaryInput`, `OverlayBoundaryEdge`,
  `OverlayBoundaryFinding`, `OverlayBoundaryResult` and `OverlayModuleRef`.
