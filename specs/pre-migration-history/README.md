# Pre-migration history

Endora Commerce was developed in a self-hosted GitLab repository before this one became canonical.
That repository is kept as the **historical repository**: reachable by the team, not written to
(`CONTRIBUTING.md` § *Where to send a change*). This repository's history was produced from it by a
one-time filter that published some paths and withheld others, and the filter gave every published
commit a new id. This directory is what connects the two: a commit id, a feature number or a ruling
number written before the migration resolves through it.

It holds two things, and neither changes again — the migration happened once.

## `commit-map`

One row per commit of the historical repository, two commit ids separated by a single space:

```text
<id in the historical repository> <id of the commit here carrying the same change>
```

- **The left column** is a commit in the historical repository. Every commit it held up to the
  migration has a row.
- **The right column** is the commit in this repository that carries the same change.
- **A right column of forty zeros** (`0000000000000000000000000000000000000000`) means the commit
  touched only paths that were not published. It has no counterpart here; its row exists so that
  *absent from the map* means *not a pre-migration id* and nothing else.

The file holds commit ids and nothing else — no path, message, author or date — and its rows are
sorted by the left column. That is asserted by `backend/test/unit/docs/pre-migration-history.test.ts`,
together with the file's SHA-256, so it stays byte-identical to the map the migration produced:
`00d535475bd71c7da8475325a361b78ddb87bccb05b21520b976ff11f9f5173d`, 6 401 rows.

### Resolving a citation

Code comments, specifications and commit messages written before the migration cite commits by an
abbreviated id, usually nine characters. That abbreviation is a prefix of a left-column id, so:

```bash
grep '^c26a622c1' specs/pre-migration-history/commit-map
# c26a622c1b14d76a5fef95e4ba2082136c8ac5ee 59a212961726dfcadcf832cccb31e9646cc3913f
git show 59a212961
```

No output means the id is not a pre-migration commit — check it against this repository's own
history instead. A right column of zeros means the change was withheld and there is nothing here to
show.

### The migration itself

| | |
| --- | --- |
| Source commit in the historical repository | `d595cf8b04e156bc2711fcc6d70092a7847ca8e4` |
| Published tip | `59a212961726dfcadcf832cccb31e9646cc3913f`, the image of `c26a622c1`; the four merges after it touched only withheld paths and map to zeros |

## The numbering floors

Feature directories (`specs/NNN-slug/`) and rulings (`D-nnn`) are numbered in one series across both
repositories, so a number cited anywhere keeps pointing at one thing. The directories and rulings
below these floors stayed in the historical repository, which is why this tree cannot derive the
floors from what it holds, and why they are written down here and nowhere else.

| Floor | Value |
| --- | --- |
| Last pre-migration feature | `136` |
| Last private ruling | `D-283` |

So **the first feature directory created in this repository is 137**, and **the first ruling made
here is D-284**. A lower number is either a pre-migration citation or a collision.
`.specify/scripts/bash/create-new-feature.sh` reads the feature floor from the table above and
refuses to number at or below it; the architect agent prompts cite this file. Change the table's
shape and that script, and the test named above, go red — which is the intent.

A few pre-migration directories were moved into this tree when a public file needed them (for
example `specs/110-instance-repository/`). They keep their original number; they are below the floor,
not a gap in it.
