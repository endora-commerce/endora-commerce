---
---

The series rule and the translation that makes it land empty (feature 114
Phase 3, D-225): `check:release-intent` gains `major-bump-in-a-zero-series`,
and the nineteen `major` declarations pending in `.changeset/` become `minor`.

No release meaning. Nothing under `packages/` changes — the check is
`backend/scripts/check-release-intent.ts` and `backend` is in
`.changeset/config.json`'s `ignore` list — and the fifteen translated
changesets keep every summary body byte for byte, so what each of them releases
is unchanged. What moves is the arithmetic those bodies are released under, and
D-225 is the ruling that moved it.
