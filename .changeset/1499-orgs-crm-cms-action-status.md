---
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-cms': patch
---

More admin screens show an action's result beside the control that caused it, not as a success banner (issue #1499, UX audit SALES-17; owner decision DEC-12 a). Each result is an `InlineStatus`, a polite status region that is mounted before it has any text, so screen readers announce it. Errors are still a banner, and an error clears the result.

- Organization detail, moderation: "Organization approved", "blocked" and the other transitions appear beside the moderation buttons.
- Organization detail, hierarchy: "Organization parent updated" appears under the parent picker.
- Organization detail, VAT validation: the outcome appears beside "Validate now". Only a validated identifier is shown as a success; format-only and deferred validations are a warning, a rejected identifier is shown in the error colour.
- Organization detail, roles: a created, saved or deleted role is reported beside the Create role button in the tab's header. Opening the editor or a delete clears it.
- CRM opportunity: coming back from creating an order or a quote request, the linking progress and its result appear beside the Create button that started it, instead of a banner under the section heading. A document that was created but not linked is a warning, with its link.
- CMS brand settings: "Brand settings saved" and "The channel follows the global brand settings again" appear beside Save in the page header. The next edit, a channel switch or starting an override clears it.
