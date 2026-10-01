---
'@endora-commerce/platform': patch
---

A scaffolded instance's API no longer dies at boot under `pnpm run dev:all` with `unable to determine transport target for "pino-pretty"`. The platform names `pino-pretty` as its development log transport, and now declares it as a dependency and hands pino the path it resolves from the platform itself. If `pino-pretty` still cannot be resolved, the platform logs plain JSON instead of refusing to start. Production (`NODE_ENV=production`) never uses the pretty transport and is unaffected.
