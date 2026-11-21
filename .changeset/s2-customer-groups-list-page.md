---
'@endora-commerce/mod-customer-accounts': patch
---

The Customer groups screen is now a standard list page. *New customer group* in the header opens a dialog, so the create form is no longer always open above the list. *Edit* and *Delete* are in each row's action menu, and *Delete* asks for confirmation first. An empty list shows an empty state with a create action. In a new group the code is proposed from the name, and a code another group already uses is refused rather than overwriting that group.
