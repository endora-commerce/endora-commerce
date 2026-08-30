---
'@endora-commerce/contracts': patch
'@endora-commerce/mod-i18n': patch
---

Close D-129's sweep: the platform error-code block is 21 codes with a reason each, and a gate
that says so.

**`@endora-commerce/contracts`** — `errorCodeTokenRe`'s doc block said the envelope "falls back
to `errors.<CODE>`" when a token key is missing. It does not, and it never did:
`localizeErrorEnvelope` composes one key — `errors.<CODE>.<token>` when the raise carries a
`details.code`, `errors.<CODE>` when it does not — asks for it once and never re-asks. The
correction matters to anyone declaring `tokens`, because it decides whether a code whose every
raise is tokened needs its base sentence at all. It does, but for the check rather than for the
operator (D-190). No shape changes; this is the published `.d.ts` telling the truth.

**`@endora-commerce/mod-i18n`** — the same 21 declarations, regrouped by the ground that put each
one there, with the block's doc comment rewritten to read as the platform block's home rather
than as what a migration left behind. Nothing a consumer resolves moves: the codes, their
`tokens` and every `errors.*` key in the bundle are unchanged.

D-129's sweep is now complete — 79 codes moved into 20 modules over seven merge requests, 21
stayed. Each of the 21 is annotated with its D-121 tier and the sentence that argues it, and
`_i18n`'s declarations are held equal to those annotations in both directions, with the
annotations' own membership held against the frozen chain capture plus the re-homing and minting
ledgers. A twenty-second code cannot reach the platform block by nobody deciding.
