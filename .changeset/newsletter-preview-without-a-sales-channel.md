---
'@endora-commerce/mod-newsletter': patch
---

Previewing or sending a newsletter campaign that has no sales channel no longer fails. The channel
of such a campaign is read back from the database as `undefined` rather than `null`, and that value
was handed unchanged to the branding source, whose settings read refuses anything that is neither a
channel id nor `null` — so the preview answered `500`, and the send of the same campaign, and every
send step of an automation with no sales channel, failed the same way. It showed only in a
deployment that contributes e-mail branding, which the default one does.

A campaign or automation with no sales channel is now previewed and sent with the **default** sales
channel's logo and accent colour. One that has a sales channel is unaffected.

No API, setting or permission changes.
