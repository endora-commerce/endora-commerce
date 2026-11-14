---
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-organizations': patch
---

The product editor, the category editor, the sales-channel editor and the organization and customer detail screens now pass `saveSession: INERT_SAVE_SESSION` to their zones (issue #407). None of these editors runs a save session yet, so nothing changes for operators. The `core` catalogue adds the save-session notices and the "switched off" message in English and Polish (`saveSession.notice.moduleOff`, `saveSession.notice.crashed`, `saveSession.error.moduleOff`).
