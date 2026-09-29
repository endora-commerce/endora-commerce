---
'@endora-commerce/cli': patch
---

`endora install` no longer treats Docker as running when no daemon answers. Its probe runs `docker info --format '{{.ServerVersion}}'`, and Docker CLI 28 exits 0 with an empty line when nothing is listening (29 exits 1). The probe now requires a server version on the output as well as exit 0, so on Docker 28 with the daemon stopped `endora install` refuses before writing anything and names `--no-services`, instead of proceeding to `pnpm install` and a services step that cannot start.
