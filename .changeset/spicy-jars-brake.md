---
'@endora-commerce/cli': minor
---

Add `endora check` — the platform's static-check estate evaluated against one module package.

New on the `./checks` subpath: `runCheck(options)`, `ESTATE`, `PACKAGE_HOSTS`, `pendingEntries()`,
`resolvePackageLayout(dir)` and the `RunReport` / `RuleResult` / `EstateEntry` shapes. New on
`./rules/*.js`: the five relocated analyses this build hosts — `nul-bytes`, `bundle-pairing`,
`container-imports`, `subscribe-seam` and `command-coverage`. Each is the **same function**
`backend/scripts/check-<name>.ts` calls; a rule has one implementation and two hosts, and a
consumer that wants a rule's analysis should import it from `./rules/<name>.js` rather than
re-deriving its population.

```
cd path/to/my-module-package
endora check                # every rule, one verdict each
endora check --list-rules   # the estate's ids
endora check --as-platform  # acknowledged findings read as findings
```

`endora check` exits **0** only when the whole estate was evaluated and found nothing, **1** when
it was completely evaluated and there are findings, and **2** when the picture is incomplete —
which in this build is every package, because twenty-one rules have no package-scope host yet and
each says so with the phase that lands it. `findings=<n>` is printed on the arithmetic line
whatever the exit code is.

Two behaviours a consumer should know about. A rule is `not-applicable` only when the package's
own `package.json` or manifest declares no subject for it, and the report names the declaration it
looked for; a **declared** layer with no source is a short walk and exits 2. And a package may
declare `endora.checkLedger` — a keyed, reasoned, two-way file of acknowledged findings which
suppresses the author's exit code and never `--as-platform`'s.

One breaking change to an existing export: `isMigratedModulePath(relPath, migrated)`'s second
argument is now required. It defaulted to this repository's rollout ledger, which is a fact about
these modules and has moved to `backend/scripts/check-command-coverage.ts` with its host.
