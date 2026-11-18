---
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-i18n': patch
---

The quote-request detail keeps the Modify (negotiation) draft across tab switches (issue #1469, UX audit SALES-03). The Modify card stays mounted while the other tabs are shown, its tab carries an "unsaved changes" mark, and while the draft differs from the stored request Approve, Prepare the customer's basket and the PDF export and send wait — they act on the stored revision — with a note that says so and leads back to the tab. A link away asks Save / Discard / Stay through the kit's unsaved-changes guard, and a reload after a save no longer blanks the screen. New `core` copy: `rfq.detail.modify.unsaved.body|blocked|open`, `rfq.detail.tabs.modifyUnsaved`, in English and Polish.
