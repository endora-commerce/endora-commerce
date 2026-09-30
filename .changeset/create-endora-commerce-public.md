---
"create-endora-commerce": patch
---

`create-endora-commerce` is no longer `"private"`, so the next release publishes it. It is the
one-shot front door — `npx create-endora-commerce <dir>` hands straight to `endora install` from
`@endora-commerce/cli` — and until now it was kept out of every publish because the private
registry it used to be released to cannot serve an unscoped name. It is published to public npmjs
only; nothing about its behaviour changes.
