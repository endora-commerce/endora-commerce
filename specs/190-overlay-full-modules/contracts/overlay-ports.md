# Contract — Overlay ports and dependencies between overlay modules (FR-070 – FR-072, R-11, #1854)

Stands alone; may precede the MikroORM 7 switch.

## §1 Publishing

The owner overlay registers the port with `ctx.di.providePort('<name>', …)` (unchanged — gated on its
effective state) and declares its types in `apps/<deployment>/modules/<owner>/ports.ts`. The file may
also hold values for the owner's own use (`ledger_vendor_fixture/ports.ts` keeps its refusing default
client there); a consumer may import only its **types** (§2), so a value in it is never evaluated
outside the owner's gate.

## §2 Consuming

```ts
// apps/acme/modules/acme_reports/backend.ts
import type { LoyaltyReadPort } from '../acme_loyalty/ports.js';

export function registerModule(ctx: ModuleContext): void {
  const loyalty = lazyPort<LoyaltyReadPort>(ctx, 'loyaltyReadPort');
  // …
}
```

Sanctioned iff **all** hold:

1. the import is type-only (`import type` or every specifier `type`-qualified);
2. it resolves to exactly `<sibling>/ports.ts` (or `ports.js` / `ports.d.ts`);
3. both files are in the **same** deployment's `modules/`;
4. the importer's manifest `dependencies` (transitively) contains the sibling.

Anything else between overlay modules — a value import, another file of the sibling, another
deployment, a missing dependency — is a finding naming importer, target, file and the failed clause.
An overlay importing a **core or package** module's internals stays the existing boundary rule
(packages: their published subpaths only).

## §3 One analysis, two readers

The analysis lives in `packages/cli/src/lib/overlay-boundary.ts` and takes a source tree plus the
deployment's manifests. Readers:

- this repository: `check:module-boundary`, whose module identity is already the directory
  (`apps/<deployment>/modules/<id>` vs `modules/<id>`), replaces its ledger treatment of such an edge
  with the analysis' verdict;
- an instance: `endora generate`, which already parses overlay sources for the divergence derivation.

## §4 Dependencies

Manifest `dependencies` naming another overlay id: composition, migration order
(`overlay-schema-discovery.md` §2), install refusal of a missing dependency, and dependency
fail-closed on both activation axes behave exactly as between core modules (the resolved registry
already holds overlay entries; this contract requires the tests that prove it). `check:port-dependencies`
reads the edge from the `lazyPort` literal as today; overlay manifests are already in its population
(issue #210).

## §5 Divergence

A port an overlay provides is `port-provided` and one it consumes from **core** is `port-consumed`
(unchanged). A port consumed from a **sibling overlay** is the deployment's own surface and is listed
under `notRecorded` — it diverges from nothing in core.

## §6 Tests

Fixture deployment with two overlay modules: sanctioned import passes; each failed clause of §2 is
its own red case; deactivating the owner with the dependent on is refused naming it; hard-uninstalling
the owner with the dependent installed is refused (`dependents-block`).
