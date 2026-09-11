# i18n — shipped languages, and where a string is translated

**Open this before shipping any user-facing string** — an admin literal, a module bundle, an
error sentence, an e-mail, a notification, a PDF — and before deciding whether the backend or
the consumer does the translating. One of the bodies `AGENTS.md` routes to; it is the single
home for these rules, so never restate them in `AGENTS.md` or in a tool-specific pointer file.

All user-facing strings ship in **both `en` and `pl`**; a static CI check rejects hard-coded
literals in the admin SPA (`pnpm --filter backend run i18n:hardcoded`, in the `quality` job since
issue #116 — before that it was cited here while running nowhere). It compares the tree to
`HARDCODED_STRINGS_BASELINE`, a **per-file two-way ratchet** over the 274 pre-existing findings: a
new hard-coded string fails, and so does a baseline number left standing after the strings under it
were translated. Never raise a number to make the build pass — add the key. Run
`pnpm --filter backend run i18n:hardcoded -- --strict` to see the whole remaining debt, or pass one
path while draining a screen.

**Read those first two clauses as a rule and an instrument, not as a rule and its enforcement** —
the semicolon has been doing work it cannot do. The rule is every user-facing string; the
instrument is `.tsx` files under three admin roots, judging JSX (`collectTsxFiles` pushes a path
only `if (entry.endsWith('.tsx'))`, and the classifier's two branches are `ts.isJsxText` and
`ts.isJsxAttribute` over four attributes). **Prose a backend module composes is outside it by
construction**, and not by a root that could be added: a module's backend sources are `.ts` and
contain no JSX, so a backend root adds zero files to that walk while enlarging what its `read:`
line claims — issue #244's shape arriving through the repair. `check:language` does not cover it
either, and there too the reason is design rather than oversight: Principle VIII v3.0.0 names
inline comments and `/docs/` pages and says string literals MAY be in any language, which its
per-extension regex implements by matching only a line carrying a comment marker **and** a
diacritic. So a Polish notification title in a module's service breaks the *first* clause above
and no principle and no check — which is how an admin notification came to be a finished sentence
in whichever language its module was written in, English for four modules and Polish for a fifth,
rendered raw beside bell chrome that is translated eleven lines away. 45 such literals stand
across three delivery seams; the measurement, the shape and the instrument are designed in
`specs/093-backend-delivered-prose/`. Until that lands, **this paragraph is the only thing between
an author and shipping the forty-sixth**.

**The translation policy, owner ruling of 2026-09-01 — and it binds the storefront, the admin and
the backend alike.** Three clauses, in the owner's terms: *every module's messages are in **English
by default***; *every module or package we implement ships a **Polish** bundle too*, so two
languages are the floor and not the ceiling; and *a missing Polish message **falls back to
English***. It lives here rather than in `.specify/memory/constitution.md` deliberately — Principle
VIII governs which language the **source artefacts** are authored in and was narrowed in v3.0.0 to
comments and `/docs/` precisely so that it would not be read as a user-facing translation rule.
Putting this beside it invites exactly the conflation that has already happened once in writing:
a Polish string literal is not a Principle VIII violation, and the repair that premise suggests
would make every correct Polish seed sentence in the tree a finding. If the owner would rather it
were constitutional, the amendment is drafted for them in
`specs/094-translation-boundary/contracts/translation-boundary.md` § 5; **one home either way,
and a pointer from the other** — never two statements of one rule.

**Where it already holds, measured rather than assumed.** The **storefront** implements all three
clauses and is the strongest of the three surfaces: `storefront/lib/i18n/messages.ts` declares
`const MESSAGES: Record<string, Record<MessageKey, string>>`, and that inner `Record` is **total**
— so a Polish string missing from the catalogue is a **`tsc` error**, not a runtime fallback, and
`pnpm -r run typecheck` is the instrument. Its `tForLocale` still carries the runtime chain
(requested locale → `en-US` → the key), which is what answers a *third* locale nobody has written
a catalogue for. The **admin** implements the same chain independently in
`packages/admin-kit/src/i18n/resolver.ts` (`FALLBACK_LANGUAGE = 'en'`, requested → English →
`${scope}.${key}`), with one structural caveat: the English step is attempted only when the caller
supplies `fallbackBundle`. There is exactly one caller that builds those arguments —
`TranslationProvider`'s `t` — and it *self-supplies*, fetching the English bundle itself whenever
`language !== 'en'`, so the policy holds by construction and not by anyone remembering. **The
window where it does not** is between the two awaits: `setBundle` lands before `getBundles('en')`
resolves, so for one network round-trip a key missing from `pl` renders `scope.key` rather than
English. The resolver names that state itself (`outcome: 'placeholder'`), which is where to look.
The **backend** implements no clause at all for the prose it composes and delivers — that is
`specs/093-backend-delivered-prose/`.

**The second clause's gap is closed, and it was locked at zero violations.** 62 of the 69
registered modules ship both `i18n/en.json` and `i18n/pl.json`, 7 ship neither, and **none ships
one without the other** — so the invariant was true when the instrument landed, which is the
cheapest possible moment to lock one and the only moment at which its ledger is empty on the day
it arrives. `check:bundle-pairing` is that instrument (its row is in `check-inventory.md`), and the
predicate it enforces is a **conditional**: the 7 owe nothing, because a module with no
user-facing strings owes no translation.

`backend/test/unit/_i18n/registered-bundles-shape.test.ts` is the file that looked as though it
already did this, and it was a two-way miss — the family this repository spends its review effort
on, a population derived from the artefact under judgement. Its symmetry case read
`if (!en || !pl) continue;`, so a module that dropped `pl.json` was **skipped by the case whose
subject is bundle symmetry**; and its action-key case iterated `loaded.byLanguage`, the languages
*that module happens to ship*, so a module shipping only `en.json` had its keys checked against
English and passed. This file's own description of that test — *"every manifest action key
resolves in every shipped language"* — was true, and "every shipped language" silently meant the
module's rather than the platform's; the two read identically and are not the same claim.
**Measured**: with `packages/modules/blog/i18n/pl.json` removed, that file passed 66 of 66. Both
halves are repaired in the merge request that landed the check — the action-key case iterates
`SUPPORTED_LANGUAGES`, and the symmetry case separates the two states its disjunction ran together
(*neither* bundle is the module that ships no strings, *one* is a failure) — and on the same tree
it now fails two cases. The two instruments are not duplicates: the check answers file-level
presence over every registered module, the test answers key-level resolution inside the bundles a
module declares.

**Where the translation happens is a separate question from which languages exist, and it has a
boundary** (owner question of 2026-09-01, analysed in `specs/094-translation-boundary/`). The rule
is **not** "the backend returns codes and the consumer translates", and it is not the opposite
either — it turns on one derived fact:

> **Can the backend resolve the reader's language at the moment it composes the string?**

- **It can** — an HTTP response (the request's language, feature
  `specs/083-buyer-language-resolution/`), an e-mail (the recipient's), a PDF (the document's
  `locale`). The backend translates, **and ships the code too**. That is what the error envelope
  already does: `error.code` is on the wire for a consumer to branch on, `error.message` is the
  sentence the backend resolved. Do not move this to the consumer; it is what issue #234 fixed,
  and a third-party consumer with no vocabulary would render raw codes.
  **"Can" means capability, not current practice** — a site with a resolvable reader that simply
  does not consult them is case 1 with the translation step missing, never case 2. Read it the
  other way and the rule is circular: it would classify every un-internationalised site as case 2
  and ratify whatever the code already does. `organizations`' `describeStatus` is the worked
  example — Polish prose composed on a request whose language `createRequestLanguageResolver`
  resolves and whose *error envelope already uses that resolution*, returning
  `{ status, reason }` so the machine token is on the wire beside the prose and only the
  translation step is absent.
- **It cannot** — the reader is plural or reads later. An admin notification is the case: one row,
  many administrators, different `preferredLanguage`. Ship a key, its params **and an English
  fallback sentence**; the consumer translates. That is `specs/093-backend-delivered-prose/`.
- **There is no reader with a language** — a webhook payload, an integration document. Ship a code
  and **no prose at all**. `webhooks`' `eventType` already does.

**Four kinds of string leave the backend and only the first is in scope**, which is the
distinction that makes the question answerable: *platform prose* a developer wrote (a bundle,
`en` + `pl`); *operator content* the shop wrote (per-language columns — a category name, a
transactional-email body — and never a bundle); a *machine token* (`eventType`, `error.code`, a
status — never translated); and *third-party text* passed through verbatim (a vendor's failure
detail — never translated, and wrapping it is a different decision). Sweeping these together is
how "should the backend hold translations" becomes unanswerable.

**Classify by where the string is *read*, never by what carries it.** A mechanism-keyed population
is defined by the presence of the mechanisms somebody enumerated, and they are unbounded:
`specs/093-backend-delivered-prose/` surveyed three delivery seams — a port call, a mailer, a
renderer — and the tree held six more shapes carrying prose, among them a plain `return` from a
route handler and a push into a persisted log, one of them in a file that survey had already read.
A string does not become user-facing by being carried; it becomes user-facing by being read. So
the population is *a string a human eventually reads* and the question above is the whole
classifier — it answers for the shape nobody has thought of yet, which a list cannot.

**The first clause has an instrument too, and unlike the second's it did not land empty.**
`check:default-language-prose` (its row is in `check-inventory.md`) refuses *a prose literal in a
natural language other than English, outside a per-language structure, in a module's own sources*
— which is what "English is the default" says, enforced as written. Its asymmetry is the rule and
not a limitation: it finds non-English prose and says nothing about English prose, because under
this ruling an English literal is not a finding. It is therefore **not** an instrument for "is
this string translated"; that is `specs/093-backend-delivered-prose/`'s question for the case-2
seams and `tsc`'s for the storefront. **46 sites over 41 keys stood when it landed**, in a
per-module ledger under `backend/scripts/ledgers/non-english-defaults/` that is two-way and
expected to empty — every entry names its literal, says what the site is and says which case of
the boundary above its repair takes, so a reader is sent to the right repair rather than to the
finding. Its bound is declared rather than discovered: detection is **Polish only**, by
`check:language`'s own diacritic class plus a stopword list, so Polish carrying neither signal is
invisible (`'Nowa Organizacja'` is the measured example) and a third shipped language is exit 2
until it has a detector.

**The cost of consistency is nearly nil, and that is the finding rather than a convenience**: every
seam in the tree already sits on the correct side of this boundary, and what is left is
translation steps that were never wired rather than designs that were wrong. So this is a rule for
new code with two draining ledgers, not a migration.

