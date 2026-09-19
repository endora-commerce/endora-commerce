---
'@endora-commerce/test-kit': minor
---

`composeTestServer` registers the sales-channel kernel it composes

It composed the kernel — it has to, the subscriber ordering depends on that happening above
`composeModules` — and then registered none of the four names `compose-app.ts` registers out of
the same object, nor the out-of-request channel resolver a channel-scoped settings read needs. So
the kernel existed and nothing could resolve it: `inventory`'s channel-scoped stock read,
`payment_methods`' and `delivery_methods`' auto-bind and every channel-bridge declaration each
failed with `AwilixResolutionError` on their first call, in a composition that had booted cleanly.

It stayed invisible in the monorepo because the reference harness registers all four itself,
under a comment reading *"mirrors `compose-app.ts`"* — the one caller that would have noticed had
already worked around it. An out-of-tree host booting the published platform through the kit found
them one failed boot at a time.

`registerValues` overwrites and the harness contributes identical values, so that workaround stays
correct while it is removed. A caller that wants a different answer for one of the five still says
so in `contribute`, which runs after.
