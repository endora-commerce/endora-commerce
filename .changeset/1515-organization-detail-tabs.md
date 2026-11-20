---
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-related-payers': patch
---

The organization detail screen is one card with tabs instead of sixteen stacked cards and five more from other modules (issue #1515, UX audit 2026-11-17 SALES-02).

- **Overview**: moderation, registered address, hierarchy, custom fields. **Members & roles**: the members and the roles. **Commerce**: sales channels, order-confirmation e-mails, restrictions, fulfilment, the price books that apply, and every `organization.detail.after` panel. **Tax**: the tax ID and VAT status with *Change tax ID…*, *Change VAT status…* or *Convert to company…*, then VAT validation. **Sales**: the sales representatives, offered only with `organizations:assign-sales-rep`. `?tab=` opens a tab. A tab holding unsaved changes says so, and switching tabs keeps them.
- Every panel is a section of the tab's card, not a card of its own; `organization.detail.after` is mounted in the Commerce tab without `chrome="card"`, so its contributions render as sections. The related-payers panel is an `EditorSection` now, like the other contributions.
- The header holds *Back* and the page Save, the one primary. The tax corrections moved to the Tax tab, and their result is said beside them.
- Moderation offers only the transitions the status allows (issue #1541, SALES-15): Approve and Reject while pending, Block while active, Unblock while blocked, none once rejected. The registry-divergence notice's link opens the Tax tab at the VAT validation.
- The sales-representative remove button has an accessible name, and its result is said beside *Assign* instead of an info banner.
