---
'@endora-commerce/mod-customers': patch
---

The admin customer detail asks before blocking a customer, resetting their two-step verification or deleting them (issue #1471). Each question names the customer and what the action does, opens with focus on Cancel, and runs the request inside the dialog: busy while it is in flight, and a refusal (the last administrator of a company organization, for example) stays in the dialog. Delete moves out of the action row into its own section at the end of the page; Block is no longer styled as a destructive button, since Unblock reverses it.
