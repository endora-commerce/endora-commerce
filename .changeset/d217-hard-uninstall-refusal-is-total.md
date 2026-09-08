---
---

D-217 changes what `module:uninstall --hard` **promises** and not what it does, so there is
nothing to release.

`specs/018-module-lifecycle/contracts/cli-commands.md` §C-2 step 6 offered two ways past the
`--force` requirement — the flag, *or* a tty prompt confirming `yes` verbatim — and the second
was never built in either tree. The owner struck it. `@endora-commerce/platform`'s edit is two
doc blocks: `OperatorRuntime.confirm` now says that nothing supplies it as a settled answer
rather than a state of play, and `runUninstallCommand`'s header cites the ruling instead of
naming it as open. The predicate, the exit code and every sentence an operator reads are
byte-identical.

**One thing a consumer building its own entry point should read**, and it is in that doc block
rather than here because that is where such an author is: supplying `confirm` without a prompt
behind it takes `--hard` past the refusal and into reverting a module's migrations and deleting
its registry row. The field is kept as the seam a future confirmation would use, not as a knob.

`@endora-commerce/mod-pim-pimcore` gains a co-located test and its `.json` vectors under `src/`
(D-218), which the emit excludes and the asset classifier now calls a fixture, so its published
tarball is unchanged too.
