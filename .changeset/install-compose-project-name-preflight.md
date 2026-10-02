---
'@endora-commerce/cli': patch
---

`endora install` no longer lets two instances share one development stack. Compose names a project after its directory, so a second instance called `shop` — under another parent, or written again after the first was deleted — adopted the first one's containers and mounted its volumes without a word. Before anything is written the run now asks Docker whether a project of the directory's name already has containers or volumes on this machine. If it does, the stack gets a name of its own (`<dir>-<six hex of the path>`), written as `COMPOSE_PROJECT_NAME` into the instance's `.env` and said in the output; `pnpm run dev:services` and `dev:services:down` follow it unchanged, because Compose reads that file. A `COMPOSE_PROJECT_NAME` you set yourself is never replaced: if it is taken the run refuses, naming what holds it.
