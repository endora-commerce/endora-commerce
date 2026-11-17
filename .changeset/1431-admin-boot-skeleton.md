---
'@endora-commerce/admin-kit': patch
'@endora-commerce/admin-shell': patch
---

The admin no longer shows raw translation keys or a "page not found" message while it starts (issues #1431 and #1485). After sign-in, `App` shows a loading skeleton shaped like the shell until the operator's translation bundle and the module-presence list have loaded. The skeleton is announced as a status in the operator's language. It also opens when either request fails, so it never stays on screen for good.

`TranslationProvider`'s context, read through `useTranslationContext()`, has a new `ready` field. It is `false` until the provider's first bundle request settles, and `true` from the start when `initialBundle` is passed. After a language change it stays `true`, and the previous bundle stays on screen until the new one arrives.

`App` takes an optional `translations` prop, beside `modulePresence`. It hands a bundle the caller already has to the provider, so the shell opens on its first render. A test that renders `<App/>` and checks the shell right away should pass it. `translations={{}}` keeps the old output, where every key renders as `scope.key`.
