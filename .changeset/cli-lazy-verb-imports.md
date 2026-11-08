---
'@endora-commerce/cli': patch
---

`endora` loads a command's code only when that command runs. `endora dev` (an instance's `pnpm run dev:all`) and `endora --help` no longer load the TypeScript compiler, which only `endora check` uses. Each of them used to spend about two seconds of CPU on it before doing anything. `endora dev` now starts its first layer in under a tenth of a second.
