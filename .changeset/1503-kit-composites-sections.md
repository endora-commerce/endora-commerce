---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-sales-channels': patch
---

The last kit composites that drew their own card or bordered box are sections of the card they sit in (issue #1503, UX audit SHELL-22; the DS-03 rule from #1437).

**Breaking visual change for modules (0.x, so released as a minor). Upgrade note:**

- `ScopePicker` (`@endora-commerce/admin-kit/components`) no longer draws its own `Card`. It renders as an `EditorSection` and follows its mount. A picker placed on its own, between a page's cards, must pass `chrome="card"` to keep its card: `<ScopePicker value={scope} onChange={setScope} chrome="card" />`. It also takes `titleAs` (`'h3'` inside a titled card).
- `FieldProtectionPricePanel` (`@endora-commerce/admin-kit/field-protection`) no longer draws a bordered box. It renders as an `EditorSection` whose heading names the source, with the description as its one line, like `FieldProtectionSummary`. Pass `chrome="card"` where it stands alone on a page; it also takes `titleAs`.
- `CommentThreadCopy.hint` is optional. Omit it when the thread has no rule to state, and nothing is drawn above the thread. Passing it still works as before.

The blog and CMS editors mount `ScopePicker` with `chrome="card"`, so they look as they did. The sales-channel editor's warehouse routing (`inventory`, `sales_channel.editor.after`) is one section, with the add form as an `h3` sub-section, a load or write failure as an alert and its confirmations as a status line, in place of up to four cards; the sales-channel editor mounts the zone with `chrome="card"`. A product feed's Settings tab is one card with five sections instead of five cards.
