---
"@endora-commerce/cli": patch
---

`endora new storefront` now declares everything its ESLint configuration needs.

The scaffold vendors the platform repository's shared `eslint.config.js`, which imports
`@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `eslint-plugin-react-hooks` and
`eslint-plugin-jsx-a11y`. None of them, nor `eslint` itself, was in the scaffolded
`package.json`, so `pnpm run lint` failed to load its configuration on a fresh install. The
scaffold's `devDependencies` now carry all five. The command also refuses to write a storefront
whose vendored configuration imports a package its manifest does not declare, so this cannot
happen again silently.

**If you scaffolded a storefront with an earlier version**, add them to its devDependencies:

```bash
pnpm add -D eslint@^10.2.1 @typescript-eslint/parser@^8.59.0 @typescript-eslint/eslint-plugin@^8.59.0 eslint-plugin-react-hooks@^7.1.1 eslint-plugin-jsx-a11y@^6.10.2
```
