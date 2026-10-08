---
'@endora-commerce/admin-shell': minor
'@endora-commerce/mod-i18n': patch
---

The Admin UI's sidebar has a "CRM" section, placed after *Sales*. The shell declares no row in
it: every entry is a module's contribution (`section: 'crm'`), so the heading renders only
while a module contributes an entry the operator may see. Its label is `appShell.section.crm`
in the core bundle, in English and Polish.
