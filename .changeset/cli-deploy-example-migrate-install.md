---
'@endora-commerce/cli': patch
---

The example deployment files `endora new instance` writes now migrate and install. The `backend-migrate` one-shot ran `node dist/db/migrate.js up`, a file the scaffolded backend never emits, so it exited non-zero and the API waiting on it never started; it now runs `node dist/migrate.js`, the file `backend/src/migrate.ts` compiles to. A new `backend-install` one-shot runs `node dist/module-commands/install.js --all` (the compiled `module:install --all`, idempotent) after the migrations and before the API, in `deploy/compose.prod.yml` and in the three-host `deploy/three-host/compose.backend.yml`, so a fresh database runs every module's install hooks. An instance scaffolded by an earlier version can copy the two service blocks from a newly rendered example.
