---
'@endora-commerce/cli': patch
---

`endora new storefront` now writes a `Dockerfile` that builds in the storefront it scaffolds. It used to copy the reference storefront's own `Dockerfile`, which builds from the platform repository's root and stops at `scripts/collect-workspace-manifests.sh`, a file a scaffolded storefront does not have. The rendered one installs from the storefront's `package.json` and committed `pnpm-lock.yaml`, runs `pnpm run build`, and serves the standalone output; its build arguments are the storefront's entries in the instance build-input declaration. With `--registry` it also copies `.npmrc` and reads the registry token from a BuildKit secret (`--secret id=endora_npm_token,env=ENDORA_NPM_TOKEN`), never from a build argument. A `.dockerignore` is written beside it, so `.env` and the installed trees stay out of the image. A storefront scaffolded by an earlier version can take both files from a new scaffold.
