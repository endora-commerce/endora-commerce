# create-endora-commerce

## 0.112.0

### Patch Changes

- Updated dependencies [e01e1ff]
- Updated dependencies [eeed5c8]
- Updated dependencies [0686447]
- Updated dependencies [9eee781]
  - @endora-commerce/cli@0.112.0

## 0.111.0

### Patch Changes

- ed57923: Published tarballs no longer carry source maps (issue #107). Every package publishes `dist` and
  not `src`, so each `.js.map` and `.d.ts.map` pointed at source files no consumer had; they were
  about a third of a tarball's unpacked size. Each package's `files` list now ends with
  `"!dist/**/*.map"`: `@endora-commerce/mod-quick-order` packs 69 files instead of 131 (243.6 kB
  unpacked instead of 359.9 kB), and `@endora-commerce/test-kit` packs 25 instead of 47. The
  compiled JavaScript, the type declarations and every other shipped file are unchanged, and so is
  every export. A stack trace from an installed package now names the compiled `dist` file rather
  than a source path that does not exist in the install.
- Updated dependencies [1937bed]
- Updated dependencies [4c4c869]
- Updated dependencies [ed57923]
- Updated dependencies [cffa0bf]
- Updated dependencies [cbbf070]
- Updated dependencies [e135ccc]
- Updated dependencies [f39d37f]
- Updated dependencies [3f95d1c]
- Updated dependencies [8a4ca9c]
- Updated dependencies [4d7b141]
- Updated dependencies [027aba4]
- Updated dependencies [1daba64]
- Updated dependencies [d290897]
- Updated dependencies [498b99b]
- Updated dependencies [01e73d1]
  - @endora-commerce/cli@0.111.0

## 0.110.0

### Patch Changes

- Updated dependencies [0b64c13]
- Updated dependencies [d69e765]
- Updated dependencies [717e4c6]
- Updated dependencies [3fed394]
- Updated dependencies [7a0f3e2]
- Updated dependencies [4940f0a]
  - @endora-commerce/cli@0.110.0

## 0.109.0

### Patch Changes

- Updated dependencies [5d192d3]
- Updated dependencies [8082616]
- Updated dependencies [bbf7182]
- Updated dependencies [f261ed3]
- Updated dependencies [eeed924]
- Updated dependencies [9cb3c8d]
- Updated dependencies [b6c9cb9]
- Updated dependencies [cce12dd]
- Updated dependencies [f8effbf]
- Updated dependencies [453b25b]
- Updated dependencies [46de85c]
- Updated dependencies [0d6983a]
  - @endora-commerce/cli@0.109.0

## 0.108.0

### Patch Changes

- @endora-commerce/cli@0.108.0

## 0.107.0

### Patch Changes

- @endora-commerce/cli@0.107.0

## 0.106.0

### Patch Changes

- Updated dependencies [fc23f9e]
- Updated dependencies [4be4642]
- Updated dependencies [be99bb5]
- Updated dependencies [ddc9382]
- Updated dependencies [ca6fef6]
  - @endora-commerce/cli@0.106.0

## 0.105.0

### Patch Changes

- Updated dependencies [1ba6b26]
- Updated dependencies [964ada7]
- Updated dependencies [0e34c8c]
- Updated dependencies [bdb823b]
- Updated dependencies [77a76a7]
- Updated dependencies [d09cc6d]
- Updated dependencies [fee2de0]
- Updated dependencies [8ca54eb]
- Updated dependencies [ad4aa50]
  - @endora-commerce/cli@0.105.0

## 0.104.0

### Patch Changes

- Updated dependencies [0dc258c]
  - @endora-commerce/cli@0.104.0

## 0.103.1

### Patch Changes

- Updated dependencies [3198a66]
  - @endora-commerce/cli@0.103.1

## 0.103.0

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [5afd004]
- Updated dependencies [bd70d67]
  - @endora-commerce/cli@0.103.0

## 0.102.0

### Patch Changes

- Updated dependencies [989d7a4]
- Updated dependencies [255b60b]
- Updated dependencies [5faaa66]
  - @endora-commerce/cli@0.102.0

## 0.101.1

### Patch Changes

- @endora-commerce/cli@0.101.1

## 0.101.0

### Patch Changes

- 25b99b2: The two READMEs a reader meets on npmjs now say what the packages do. `create-endora-commerce`'s still said _Not yet published_ and that its command did not resolve; it now shows the two commands, what they write, and links the getting-started page. `@endora-commerce/cli`'s was the generated stub that described "scaffolding and conformance tooling" and nothing else; it now lists `endora install`, `new instance`, `new storefront`, `new module`, `generate`, `dev` and `check` with one line each, and is hand-written from here on — the manifest generator no longer rewrites it.
- Updated dependencies [40ce6f4]
- Updated dependencies
- Updated dependencies [40ce6f4]
- Updated dependencies [40ce6f4]
- Updated dependencies [40ce6f4]
- Updated dependencies [25b99b2]
- Updated dependencies [be758bb]
- Updated dependencies [be758bb]
- Updated dependencies [be758bb]
- Updated dependencies [5518597]
- Updated dependencies [be758bb]
- Updated dependencies [5749604]
- Updated dependencies [be758bb]
- Updated dependencies [0ad1d67]
- Updated dependencies [be758bb]
- Updated dependencies [d919418]
- Updated dependencies [be758bb]
- Updated dependencies [be758bb]
  - @endora-commerce/cli@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [fac27a4]
- Updated dependencies [99cbbcc]
- Updated dependencies [54c7417]
  - @endora-commerce/cli@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/cli@0.100.1

## 0.1.0

### Minor Changes

- 400a7c2: New package: `create-endora-commerce`, the `npx create-endora-commerce <dir>` front door. It runs `endora install <dir>` from `@endora-commerce/cli` with every argument passed through unchanged and exits with that command's exit code; it adds no option of its own and implements no scaffolding. It stays `private` until the first public release to npmjs, where it is published at the release's first public version.

### Patch Changes

- Updated dependencies [82986ff]
- Updated dependencies [c9faba1]
- Updated dependencies [797a579]
- Updated dependencies [224fe10]
- Updated dependencies [fe176a6]
- Updated dependencies [4b1844c]
  - @endora-commerce/cli@0.15.0
