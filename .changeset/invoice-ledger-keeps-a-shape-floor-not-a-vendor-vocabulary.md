---
'@endora-commerce/mod-invoice-ledger': minor
'@endora-commerce/contracts': patch
---

`@endora-commerce/mod-invoice-ledger` no longer recognises a ledger vendor's sentences; it applies a shape floor

**If you write a ledger adapter against `InvoiceLedgerDeliveryPort`, the text you pass to
`markFailed` is now stored as you wrote it, provided it looks like a sentence.** Until this
release the ledger imported two vendors' error vocabularies and stored `last_error`
verbatim only when your text was one of those vendors' sentences — anything else, including
every sentence your own adapter authored, became *"The ledger vendor returned an unreadable
error."* The floor is now vendor-independent and refuses four shapes over the trimmed input:

- it contains `<` or `>`;
- it contains a control character — a newline, a carriage return, a tab, or any of C0, DEL, C1;
- its first character is `{` or `[`;
- it is longer than 500 characters.

Any of those yields `INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR`. **Nothing is truncated** — a
refusal is whole, because half a sentence is prose nobody wrote and can cut a leaked token in
two. Whitespace-only input is refused as before, and `null` and `''` are returned unchanged.

**What this means for an adapter you maintain.** Map the vendor's HTTP outcome onto your own
operator sentence before you call `markFailed`, and assert in your own package that every
sentence you can produce clears the four clauses above. Do not hand the ledger a response body,
a header dump or an exception's `stack`: it will be stored as `unreadable` and the operator
loses the detail. If your sentence composes text the vendor wrote — a field name, a validation
message — bound that composition yourself; the 500 is a backstop, not a budget.

**Why.** `@endora-commerce/mod-invoice-ledger` is the general-purpose half of this family: it
persists a delivery and knows nothing about any one accounting vendor. It was nevertheless
importing `WFIRMA_DELIVERY_MESSAGES` and `INFAKT_DELIVERY_MESSAGES` to re-recognise sentences the
two adapters had already mapped — one vocabulary with two owners, and a vendor-agnostic package
carrying two specific integrations' error text. The vendor that authors a sentence now owns both
the vocabulary and the mapping; the ledger, which is the component that persists, keeps a floor
and no vocabulary. A registry contributed by the vendors was considered and refused: on the read
path a deactivated vendor's historical rows would re-read as *unreadable*, and on the write path
the caller **is** the vendor, so the ledger would be asking a registry the vendor populated
whether the vendor's sentence is one of the vendor's sentences.

**`@endora-commerce/mod-wfirma` is no longer named here, and the release it was promised is
the paid repository's to make.** Feature 134's wave 4 took that package out of this workspace
between this changeset being written and this release going out, so `changeset version` can no
longer honour an intent for it — `check:release-intent`'s `unversionable-changeset`, which is
the finding that exists because a changeset naming a non-member exits 0 from `changeset status`
and is byte-identical to a clean branch. The behaviour below is real and unreleased; whoever
cuts `@endora-commerce/mod-wfirma` next, from the repository that now holds its source, owes it
a `minor` and this paragraph as its body.

**`formatWfirmaValidationError` now bounds its own composed tail, and exports the bound.** The composed sentence is `wFirma rejected the invoice.` followed
by the field messages lifted out of wFirma's own JSON or XML body, which was unbounded. A field
message carrying markup or a control character is now dropped whole; a composition whose tail
exceeds `WFIRMA_VALIDATION_TAIL_MAX_LENGTH` (300, newly exported from
`./backend`'s `wfirma-rest-client`) falls back to the bare sentence. The vendor sentence is
never truncated and never exceeds the ledger's floor.

**`@endora-commerce/contracts`: a comment, and nothing else.** The doc-blocks on
`INFAKT_DELIVERY_MESSAGES` and, at the time, `WFIRMA_DELIVERY_MESSAGES` said *"Operator
sentences the … worker and ledger mapper share"*, which is the design this release overturns.
The wFirma half of that sentence has since left this package altogether — the sibling changeset
in this same release removes it — so what this `patch` still describes is the Infakt doc-block.
No exported value, type or schema changes for it; the bump is `patch` because a `.d.ts` comment
is part of what the package emits and nothing more than that moved.

**No changeset names `@endora-commerce/mod-infakt`.** Its only change is a co-located
`*.test.ts`, and `src/**/*.test.ts` is excluded from that package's `tsconfig.json` and
`tsconfig.build.json` alike — so the package emits exactly what it emitted before, and there is
nothing to version.
