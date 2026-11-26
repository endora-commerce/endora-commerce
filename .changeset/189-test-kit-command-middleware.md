---
'@endora-commerce/test-kit': minor
---

New subpath `@endora-commerce/test-kit/command-middleware` (`specs/189-command-middleware/`, issue #1840): `sealedCommandMiddlewareRegistry` seals a real `CommandMiddlewareRegistry` the way composition does, for a unit test that runs Commands on a real `CommandBus` with `{ middleware }`; `recordingCommandMiddleware` records what an `admit` and an `observe` were handed; `expectCommandMiddleware(manifest, entries, { origin })` fails with composition's own message when a declaration and a registration disagree or a phase is not allowed for the origin; `expectDeclaredRefusal(error, manifest)` fails unless a refusal's code is one the manifest declares. `composeTestServer` wires the middleware registry exactly as `composeApp` does and accepts `commandMiddlewareOrder`.
