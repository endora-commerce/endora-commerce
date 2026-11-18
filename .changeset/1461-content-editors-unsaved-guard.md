---
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-transactional-emails': patch
'@endora-commerce/mod-document-templates': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-newsletter': patch
---

Every content editor now warns before unsaved changes are lost (issue #1461, UX audit CONTENT-02). The CMS page, block and template editors, the blog post and category editors, the transactional e-mail and e-mail block/template editors, the document-template editor, the megamenu editor and the newsletter campaign and automation editors compare their draft with the last saved version, show "Unsaved changes" beside Save, and ask Save / Discard / Stay before Back, the sidebar or a closed tab throws the work away. The e-mail and document-template editors also ask before a channel or language switch reloads the canvas, and saving a megamenu binding no longer reloads the stored item tree over an unsaved one.
