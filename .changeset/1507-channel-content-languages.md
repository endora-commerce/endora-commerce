---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-newsletter': patch
---

Categories are named in every language the active sales channels offer, instead of a fixed English and Polish pair (issue #1507). The category content and product content screens offer the same languages. A stored name or document in a language no channel offers stays visible, read-only and flagged, and a save keeps it unchanged. The kit publishes `useChannelLanguages`, `loadChannelLanguages`, `offerContentLanguages` and `contentLanguageName`; the hook moved from the newsletter module's admin.
