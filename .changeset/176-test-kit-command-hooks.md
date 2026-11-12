---
'@endora-commerce/test-kit': minor
---

**`@endora-commerce/test-kit/command-hooks`** (`specs/176-command-hooks-outbox/` T027, T036): `expectHookableCommand(command, ref, { result?, sentinels? })` fails a Command declared hookable that does not match its ref or supplies no `hookData` / `outboxData` for its declared phases, and — given a result — outbox data that is not scalars or arrays of scalars or that carries a sentinel. `recordingCommandHooks()` builds recording `beforeCommit` entries for a fixture hook module, and `sealedCommandHookRegistry(...)` seals a registry the way `composeModules` does, for a unit test running a Command on a real `CommandBus` with `{ hooks }`. `composeTestServer` wires the registry as `composeApp` does and takes `commandHookOrder`.
