# Non-English defaults ledger

One `<module-id>.ts` shard per module with non-English prose still standing, read by
`pnpm --filter backend run check:default-language-prose`
(`specs/094-translation-boundary/contracts/default-language-prose-check.md` § 2.1).

Every shard has been retired: the last entries went with #556 (issues #94/#95) and #572
(issue #560). A shard is deleted when its last entry goes, because an empty shard is
refused — so this file is what keeps the directory, which the check refuses to run without,
in the tree. A new non-English default is fixed, not ledgered; if one ever has to be
recorded, add `<module-id>.ts` here in the shape the check's contract describes.
