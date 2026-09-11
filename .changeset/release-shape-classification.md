---
---

Feature 114, Phase 1 — the release gate classifies a branch by what it produced.

No release meaning: this change is `backend/scripts/check-release-intent.ts`, its two
tests, its fixture helper and `.gitlab-ci.yml`. `backend` is in this configuration's
`ignore` list and no package under `packages/` compiles any of these files into its
published `dist`, so nothing a consumer installs moves. I looked; there is nothing to
release.
