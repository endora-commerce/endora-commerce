---
title: Understanding specs/NNN citations
description: What the specs/NNN references scattered through this documentation are, and why they are plain text rather than links
---

# Understanding specs/NNN citations

Read a few pages of this site and you will meet short references that look like file paths:
`specs/016-blog/spec.md`, `specs/133-docs-site-publication/`, sometimes a bare *feature 100* or a
ruling id such as `D-198`. They are not typos, and they are deliberately not links. This page
explains what they are, so you can read past them instead of hunting for an address that would not
open.

## What a citation names

Endora Commerce is built feature by feature, and every feature is written down before it is coded.
Each one gets a numbered directory — `specs/NNN-slug/` — holding the specification, the
implementation plan, the task list and the API contracts that were agreed for it. A citation like
`specs/016-blog/spec.md` names one of those documents. `D-198` names a recorded engineering ruling,
and *feature 100* is the same kind of reference written informally. About sixty such citations
appear as plain text across this site.

Their job here is provenance. When a page says that a rule exists, the citation tells you where
that rule was decided and under which piece of work — the documentation equivalent of a footnote.
It is the answer to "who decided this, and when", not an invitation to click.

## Why none of them is a link

Some of the cited directories travel with the project's source; the older ones live in a private
historical repository that was never published. This site does not try to tell the two apart,
because a reference that resolves for the maintainers and fails for everybody else is worse than no
reference at all: it advertises a door and then refuses to open it. So every one of these
references is written as plain text, and any that were once real hyperlinks have been converted.
You will never be offered a link into a tree you cannot reach.

The address is still worth printing. A reader who has the private history — or who is looking at a
feature directory that does ship with the source — gets an exact pointer, and a reader who does not
loses nothing but a dead click. If you want to ask about one, quote it: the slug identifies the
work unambiguously to anyone who can see it.

## Why the citations are safe to publish

This project filters what it publishes against a written rule,
`specs/conventions/commercial-data.md`, and that rule is itself public — a filter whose criteria
are secret is a filter nobody outside can question. Its §4(a), *a pointer is not a payload*, is the
clause that covers these citations: a reference of the form `specs/016-blog/spec.md` discloses that
an internal document exists and roughly what subject it covers, and nothing more. Reconstructing
any commercial fact from it would require the document itself, which the reference does not carry.
That is why the citations stay in the published text as they are, rather than being stripped out —
removing them would delete the audit trail and conceal nothing.

## What you can open instead

The material a contributor actually needs is part of the published source: the engineering
conventions under `specs/conventions/`, the project constitution at
`.specify/memory/constitution.md`, and this documentation site itself. Where a page needs you to
act on a rule, it states the rule; the `specs/NNN` citation beside it records where the rule came
from. If a page ever leaves you needing the cited document in order to follow it, that is a defect
in the page — report it, and the missing content will be written here.
