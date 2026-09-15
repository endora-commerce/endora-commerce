---
'@endora-commerce/cli': patch
---

`endora check`'s estate manifest gains a row for `check:root-dispositions`, the
rule that refuses a top-level repository entry carrying no recorded disposition.

It is `repository-only`, and here that claim about the rule's *subject* is
unusually literal: a module package holds no root entry of its own — it
contributes paths under `packages/` — and the question the rule asks has already
been answered for anything a consumer installed from a registry. The row exists
anyway because the manifest is not a curated subset: a rule that can never run
for a package is printed with its reason rather than left absent, which is what
stops `endora check` becoming a list somebody updates or does not.
