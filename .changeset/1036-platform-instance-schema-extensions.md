---
'@endora-commerce/platform': minor
---

`./lifecycle` exports `runInstanceSchemaExtensionsCommand({ ormConfig })` (issue #1036): `module:schema-extensions list | drop | audit-packages` for a tree that ships no generated index — an instance. It builds the same runtime as this repository's entry point from the instance's own `mikro-orm.config.js` alone: the ORM opened on first use, the "still declared" set `drop` refuses to touch read from what that configuration recorded (and refused, not read as empty, when it recorded nothing), the installed packages for `audit-packages` discovered as the instance's `migrate` discovers them, `schema_extension.drop` through a Command Bus, the system scope, the escape-hatch audit writer and diagnostics on stderr. It opens no Redis connection and resolves no manifest set.
