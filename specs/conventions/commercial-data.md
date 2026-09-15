# Commercial data — the definition this project filters and reviews against

**Open this when you are judging whether something may be published**: a file, a page, a
changeset body, a commit message, a documentation example, or a whole tree. It is the **single
home** of the definition; every later judgement — a check finding, a reviewer's call, an
amendment — cites it rather than restating it, and no other document in this repository carries a
second copy.

It is a **rule, and never data**: it names classes and it never names an instance. That is
deliberate and it is why the rule itself is public. A project that publishes the rule by which it
filtered itself is more trustworthy than one that says only that it filtered, and a filter whose
rule is private is one nobody outside can question.

**Status: ruled, in full.** Every clause below has been ratified by the project owner. The
history of which ruling settled which clause is in §6, kept because a rule read without its
ratification is a rule somebody re-argues.

---

## 1. The operative test

> **Commercial data is information from which a reader of the public tree alone could reconstruct
> a fact about the money, the counterparties or the unpublished market position of the business
> behind the code — as opposed to a fact about the code.**

*"From the public tree alone"* is the load-bearing clause, and it is what makes §3 work. A
sentence that is only intelligible to somebody who already holds the private document has
disclosed nothing; a sentence that lets a stranger *reconstruct* the fact has disclosed it,
however obliquely it is phrased.

---

## 2. The four classes that **are** commercial

- **C1 — cost and effort *pricing*.** Person-day figures, estimates and ranges, budgets, rates,
  what a piece of work was costed at. A sentence of the form *"this feature is N–M person-days"*
  is C1 whatever the feature and whatever the numbers.
- **C2 — counterparty identity and terms.** The identity of a client, pilot, prospect or partner;
  what they bought, what they were promised, what their agreement says; deploy tokens,
  private-group membership, entitlement arrangements tied to a named party. A sentence of the form
  *"a named party's rights come from their contract"* is C2.
- **C3 — money figures about the business.** Revenue, ARR/MRR, margins, list prices, discounts,
  licence fees the business charges.
- **C4 — unpublished commercial strategy and market reasoning.** Which modules become paid before
  that is announced; a release timed to a sales event; work sequenced against a commercial
  deadline; what the owner believes about competitors.

---

## 3. What is explicitly **not** commercial, because publishing it is the point

- **N1 — engineering rulings (`D-nnn`) and their reasoning.** `specs/conventions/` and
  `.specify/memory/constitution.md` are public and both cite rulings heavily; the citation is what
  makes them worth reading.
- **N2 — code measurements, read sizes, defect counts, performance figures, dated measurement
  narratives.** `backend/test/helpers/check-read-sizes.ts` is tens of thousands of lines of exactly
  this and is the most citation-dense file in the tree.
- **N3 — architectural reasoning, alternatives rejected, branch names, merge-request numbers.**
- **N4 — a *deliberate* public statement of a commercial mechanism.** `LICENSE-COMMERCIAL.md` is
  the worked case: it states that an open-core mechanism exists and says the open/paid split *"is
  a product decision that has not been made"*. Publishing the **mechanism** is not a leak;
  publishing the **decision** before it is announced would be C4. **A statement the owner has
  chosen to publish cannot leak, because publishing it *is* the decision.**

---

## 4. Four sharpenings, all of them ruled

### (a) A pointer is not a payload

`specs/075-cross-module-decoupling-sweep/`, `D-198`, `!1651`, `feature 104` disclose that an
internal document exists and roughly what it is about. Reconstructing a C1–C4 fact from any of
them requires the private document itself. **They are provenance.**

This single rule disposes of the thousands of slug citations, `D-nnn` citations and bare
`feature NNN` references this repository carries, and it is why *"annotate once, rewrite nothing"*
survives the gate: the citations stay where they are, explained once, in `CONTRIBUTING.md`.

### (b) Effort *measured* is not effort *priced*

*"The sweep took a full day"* and *"subscribing costs about 10 MB per composition — measured, not
estimated"* are **N2**: backward observations of work already done, and they are everywhere.
*"This feature is N–M person-days"* is **C1**: a forward commitment.

**The distinguishing property is forward commitment versus backward observation, and no regex can
see it.** That is the whole reason this sharpening is written down rather than left to the term
list: when the vocabulary instrument was first run over this repository's commit messages, **12 of
the 25 messages it flagged were backward observations**. A definition that admitted them would take
the false-positive rate from tolerable to absolute, and an instrument nobody can keep green is an
instrument that gets switched off.

### (c) Product prices are not commercial data

`'PLN'` as a channel default currency, `12,50 PLN` in a fixture, a `50 000.00 PLN` credit-limit
grant in a seed are **the domain the software is about**, not the price of anything this business
sells. Fifteen commit messages and several hundred code sites in this repository match a naive
money regex and **not one of them discloses anything**.

**Only prices charged by *this* business for *its own* product or work are C3.** Without this
narrowing the instrument is unusable.

### (d) A measurement must scan for **every** class this definition names

**A class a measurement did not scan for is reported as a zero indistinguishable from a real one.**

This sharpening exists because the definition was once measured by a pass that counted **C1** cost
figures alone — the class a regex finds in one go — reported the file clean, and passed it as N2.
A later scan, re-run class by class, found **three C2 sites** in the same file: counterparty
identity, which §2 names as a class of equal standing. Together they met §1's operative test from
the public tree alone. They were removed; the general rule is this clause.

**The failure was in the reassuring direction and it announced nothing**, which is the property
that makes it worth a rule: a scan that omits a class returns the same clean output as a scan that
ran and found nothing.

**So a measurement against this definition is reported class by class, with a count per class
including the zeros, and a class that was not scanned is written as *not scanned* and never folded
into a verdict.**

---

## 5. One category the definition deliberately does **not** cover

A complete register of known, unfixed defects is **not** commercial data under §1 — it is N2,
engineering measurement, and almost all of it reads that way. But publishing one on the day of a
product's first public release is a **business** exposure of a different kind, and that is the
owner's call rather than this definition's.

**The answer taken here is larger than the question was, and it is the precedent for the next case
of this shape.** The register **stays private**; its **entry criterion becomes a public
`specs/conventions/` document**; and the stranger-actionable subset becomes **issues generated from
the file**, maintained by a required per-entry disposition and a check that refuses an entry
carrying none. So the question *"is a register of open defects a business exposure?"* is answered
**yes for the list and no for the rule**.

**The generalisation, and it is the sentence to reach for when this definition returns a clean
verdict and something still feels wrong:** *publishable* is a **disclosure verdict**, and
*published* is a **decision**. This document settles the first and never the second. A file that
discloses nothing may still be withheld for a reason that is not disclosure — that it is an
internal working note with no reader outside, that it is stale by design, that it is somebody's
scratch. Record that as a disposition with its reason; do not argue it back into §2.

---

## 6. What ruled what, and why this section is kept

| Clause | Status | Settled by |
| --- | --- | --- |
| §1 operative test, §2's C1–C4, §3's N1–N4 | **ratified as written** | D-239 |
| §4(a) *a pointer is not a payload* | **ratified**; it is the operative test the other three rest on | D-239 |
| §4(b) *effort measured is not effort priced* | **ratified** — put as P-1(a) | D-239 |
| §4(c) *product prices are not commercial data* | **ratified** — put as P-1(b); this one **contests** the line originally supplied, which listed "prices" flatly | D-239 |
| §3's N4 applied to `LICENSE-COMMERCIAL.md` | **ruled public** — put as P-1(c) | D-239, second amendment |
| §4(d) *scan class by class* | **ruled, not merely recommended** — put as P-1(d) | D-239, second amendment |
| This document's path and its public disposition | **ruled** | D-239, amendment |

**Nothing below the line is unruled**, and that matters: an earlier statement of this relocation
expected §4(d) to arrive here as *an architect's recommendation awaiting a ruling*. It was ruled
before the move happened. A public rule that does not distinguish a ruled clause from a proposed
one is worse than the private draft it replaced, so the distinction is kept here even now that it
has one value.

---

## 7. Applying it

1. **Name the classes before you scan.** All eight — C1, C2, C3, C4, N1, N2, N3, N4. §4(d) is not
   advice.
2. **Report per class, zeros included.** A table with a row per class and a count in it. A class
   you did not scan is written *not scanned*; it is never a zero and never folded into a verdict.
3. **Judge a hit against §1, not against the word that matched.** §4(b) and §4(c) exist because
   the vocabulary matches far more than it should: a currency code, a date, a duration and the word
   *pilot* are all ordinary in this domain.
4. **Clear a false positive by annotating it, never by widening the term list.** A recorded
   exception is a ledger entry with a reason somebody can read; a widened list silently stops
   refusing a real finding somewhere else. This is the estate's standing precedent —
   `specs/conventions/check-estate.md`.
5. **A heuristic's green is not a guarantee.** The vocabulary rule that automates part of this has
   a measured precision of ≈ 28 % and an **unknown recall**. It cannot see a cost stated as *"three
   weeks of work"*, a client named without the word *pilot*, or a margin written as a bare number.
   It is a tripwire on newly written prose, and it is not the thing standing between a disclosure
   and the public.

**This document is written to its own definition.** Where the source text illustrated a class with
a live figure or a live counterparty from this business, the illustration is kept and the payload
is not: a definition that demonstrates C1 by quoting an actual estimate publishes the estimate, and
a definition that demonstrates C2 by naming an actual client publishes the client. The shapes above
are real shapes; none of the numbers or parties in them is.
