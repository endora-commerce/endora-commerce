---
'@endora-commerce/cli': minor
---

`endora new instance` wires `module:schema-extensions` as the sixth operator command (issue #1036): `backend/src/module-commands/schema-extensions.ts`, a `module:schema-extensions` script in the backend member and in the root, and a README line. In the instance root, `pnpm run module:schema-extensions list` shows the declared extension columns and orphaned ones, `pnpm run module:schema-extensions drop <moduleId> [--key <key>] [--confirm]` removes orphaned ones as an audited Command, and `pnpm run module:schema-extensions audit-packages` lists what the foreign-schema guard would refuse without executing anything. An existing instance adds the four-line file and the two scripts by hand (*Upgrading an instance*, "The schema-extension commands run in the instance").
