---
'@endora-commerce/mod-blog': patch
---

The post and category editors keep unsaved edits of every language across a language switch. Until
now switching the language tab reloaded that language from the server and threw away what had been
typed in the one being left — its name, meta fields and canvas (or category description) — and a
save sent the language on screen only, so writing an English version and then switching to Polish
lost the English one. The edits of every language are now kept until the save, which sends them all
in the same two requests as before. A language switch no longer resets the fields every language
shares (slug, image, active).
