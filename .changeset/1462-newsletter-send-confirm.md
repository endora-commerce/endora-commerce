---
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-pwa': patch
---

Sending a newsletter campaign or a PWA push notification now asks for confirmation first (issue #1462). The campaign editor saves, then opens the admin's `ConfirmDialog` naming the subject and the number of subscribers the send reaches ("Send to 1,240 subscribers"); the request runs inside the dialog, which keeps a failure's error and blocks a second click. An audience that reaches nobody is refused before anything is asked, and a failed save no longer falls through to sending the last saved version. The Audience card now sits above the content. The PWA screen's send asks the same way, with the subscribed-device count for a broadcast.

`CampaignDetail.audienceEstimate`, always `null` until now, is the number of active, non-suppressed subscribers the campaign's target resolves to while it is a draft or scheduled, and `null` once it has left those states. It is counted with the same eligibility rule the dispatch uses, so the figure in the dialog is the audience the send reaches.
