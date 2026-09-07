---
'@endora-commerce/platform': minor
---

**`@endora-commerce/platform/lifecycle` gains the divergence declaration's shape rule, and only that half** (D115-3; `specs/115-lifecycle-container-move/contracts/operator-half.md` §4).

New on the `./lifecycle` barrel: `parseDivergenceDeclaration(value, path)` and `emptyDivergenceDeclaration()`. Between them they answer *"is this a declaration, and what does an absent one say"* — pure over `DeploymentDivergenceDeclarationSchema`, with `path` a caller-supplied string that appears in a refusal and is never composed, resolved or read. Measured on the moved code: zero reads of `DEPLOYMENT`, zero `process.env`, zero `import.meta`, zero Node builtins, zero path composition and zero disk; its only import is `@endora-commerce/contracts`.

**The locator did not come with them, and that is the point rather than a tidy-up.** `divergencePathFor`, `declarationPathFor` and `loadDivergenceDeclaration` compose and read a path in the deployment tree, which belongs to the tree that owns `apps/`. They stay in the application, at `backend/src/overlay/divergence-loader.ts`, and `loadDivergenceDeclaration(env, root)` now takes the application source root as a parameter instead of deriving it from its own location — so the answer survives the file moving, and the application has one `import.meta.url` root derivation rather than two byte-identical ones.

The reason is a measured defect and not a preference. That derivation was one `dirname` too high once: it composed `backend/apps/<d>/divergence.ts`, `existsSync` said no, and every deployment read as declaring nothing — with nothing able to see it, because an absent file and an empty declaration are deliberately the same answer. Three `dirname`s from `packages/platform/src/lifecycle/services/` give `packages/platform/src`, so moving the loader here would reproduce that state exactly, in the one mechanism where a wrong answer is silent.

**Nothing became public API and nothing is removed.** `PUBLISHED_SUBPATHS` stays at five; `./lifecycle` remains host-internal, so a module naming either symbol is still a `host-internal-subpath` finding. The platform's own consumption is unchanged: `composeApp` has always received the parsed declaration as a field of `ComposeModulesOptions` and has never called the loader.
