---
'create-endora-commerce': minor
---

New package: `create-endora-commerce`, the `npx create-endora-commerce <dir>` front door. It runs `endora install <dir>` from `@endora-commerce/cli` with every argument passed through unchanged and exits with that command's exit code; it adds no option of its own and implements no scaffolding. It stays `private` until the first public release to npmjs, where it is published at the release's first public version.
