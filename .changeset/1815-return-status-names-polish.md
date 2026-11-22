---
'@endora-commerce/mod-returns': patch
---

The returns admin names a return status in the admin's language on the returns list (the status column and the status filter) and in the return detail's header (issue #1815). Before, both showed the status's default (English) name to a Polish admin, while the statuses configuration page and the transition buttons already used the Polish name. A status name stored under a regional key (`pl-PL`) now also answers its language, as the backend's resolution does.
