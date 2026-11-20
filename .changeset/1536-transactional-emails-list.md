---
'@endora-commerce/mod-transactional-emails': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-payments': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-shipments': patch
'@endora-commerce/mod-tasks': patch
---

The transactional e-mails list is easier to scan (issue #1536). Each e-mail is switched on and off with a switch instead of a filled "Switch on" button, and the switch says when the change is still being saved. The Module column shows the module's name in the admin's language instead of its id, and the list can be filtered by module. The "Content" column says whether an e-mail uses the default content or is customized for all channels or per channel. While loading, the list shows a placeholder, and a failed load can be retried. In the e-mail editor, the header says where the content comes from in words, the scope list and the e-mail branding page name sales channels by their names, and the Save button reads "Saving…" while a save runs. Every module that sends a transactional e-mail now ships its name in English and Polish.
