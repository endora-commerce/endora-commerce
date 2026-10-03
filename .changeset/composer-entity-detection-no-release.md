---
---

No release: the change is in `backend/scripts/generate-composer.ts`, the monorepo's own registry
generator, which no package publishes. It now reads the entity decorator as a syntax node, so a
comment or a string that quotes the decorator no longer registers the wrong class or stops
`composer:generate`. The generated registries are byte-identical.
