# Quickstart — an overlay module that owns a table (after 190 ships)

For an instance author; paths are the instance's. This is the acceptance path of US1/US2/US3 and the
outline the published guide (`docs/docs/create-your-first-module.md`) follows.

```bash
# 1. Scaffold — manifest, backend, i18n, one org-scoped entity, its first migration, an admin screen
pnpm exec endora new module acme_loyalty --name "Loyalty" --description "Loyalty accounts" \
  --entities --tenant-scope org-scoped --admin main \
  --permission loyalty:read --action open-loyalty=/loyalty

# 2. A second migration later
pnpm exec endora new migration acme_loyalty --name add-tier

# 3. Compile + type-check (also part of `pnpm run setup`)
pnpm run build            # tsc over backend/src, then `endora build overlays` over apps/

# 4. Artefacts: divergence report, admin registry for this deployment, palette coverage
pnpm run generate

# 5. Migrate and install
pnpm run migrate
pnpm run module:install acme_loyalty
pnpm run module:status    # acme_loyalty  installed  origin overlay  migrations 2/2
```

What you get, and what refuses:

| You do | The platform |
| --- | --- |
| forget `@OrgScoped()` on the entity | refuses every process at start, naming the class |
| define a class in `entities/` and forget to export it from `backend.ts` | refuses discovery, naming the class |
| write `update "organizations" set …` in your migration | refuses at `migrate`, rolls back, names the table |
| edit a `.ts` and start without `pnpm run build` | refuses at start, naming both files |
| put a `package.json` or a `tsconfig.json` in the module directory | refuses, naming the file |
| nest a second `manifest.ts` inside the module | refuses; make a sibling module and declare the dependency |
| ship an admin route with no palette action | `generate` exits 1 (`module-without-action`) |
| switch the module off | routes 503, admin surfaces gone, rows kept |
| `module:uninstall acme_loyalty --hard --force` | migrations reverted, tables dropped |

Promoting it later: move the directory into a module package, keep the id `acme_loyalty`; the database
sees nothing pending (`contracts/overlay-module-layout.md` §5).
