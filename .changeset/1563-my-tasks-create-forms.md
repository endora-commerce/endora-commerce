---
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-projects': patch
---

My Tasks opens with the list (issue #1563): the daily digest setting is a closed disclosure in the page header that says its state ("Daily digest: off" / "Daily digest: on, 08:00") and opens the same control below the header. The `DigestControl` component is replaced by the `useDigestDisclosure()` hook, which returns the header `trigger` and the `panel`.

The task, opportunity, project and project-template create forms mark required fields through the kit's `FormField` — an asterisk and `aria-required` — with their hints and errors linked to the field (issue #1564). On the new-project form the template choice is the first field of the first card instead of a card of its own. The CRM lookup pickers accept `ariaDescribedBy` and `invalid`.
