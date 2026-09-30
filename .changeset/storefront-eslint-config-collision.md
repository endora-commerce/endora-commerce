---
"@endora-commerce/cli": patch
---

`endora new storefront` keeps the storefront's own `eslint.config.js`.

The storefront's ESLint configuration extends the platform repository's shared one, and both
are called `eslint.config.js`. The scaffold vendored the shared one under that same name, so it
replaced the storefront's own. That dropped the Next.js plugin and the React naming overrides,
and left an import that named its own file. The shared configuration is now vendored as
`eslint.config.base.js`, and the storefront's `eslint.config.js` imports it from there. The
command also refuses any plan that would write one path twice, rather than keeping whichever
file came last.

**If you scaffolded a storefront with an earlier version**, its `eslint.config.js` is the
shared configuration, not the storefront's own:

1. Rename it to `eslint.config.base.js`.
2. Recreate `eslint.config.js` from the reference storefront's `storefront/eslint.config.js` in
   the version you scaffolded from.
3. Change its first import to `import rootConfig from './eslint.config.base.js';`.
