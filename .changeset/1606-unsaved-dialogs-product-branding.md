---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-transactional-emails': patch
---

The product editor and the Email branding page ask about unsaved changes through the admin kit's one unsaved-changes guard (issue #1606), so the dialog, its focus (Stay here first) and its buttons — **Save and continue**, **Discard changes**, **Stay here** — are the same as on every other admin editor. Each screen keeps its own question: the product editor's "Save your changes at <scope>?" with the number of unsaved changes, and Email branding's "Unsaved branding changes", with the scope-switch message when the scope is switched. A link elsewhere in the admin (the sidebar, for instance) is now asked about in that dialog rather than in the browser's two-button confirmation; on the product editor, **Stay here** after the browser's Back between scopes still puts the scope back in the address.

Translation keys removed from both `en` and `pl` (the buttons now use `core` `form.unsavedChanges.*`): catalog `productEditor.guard.save`, `productEditor.guard.discard`, `productEditor.guard.stay`; transactional_emails `branding.switchScope.save`, `branding.switchScope.discard`, `branding.switchScope.stay`. A deployment that overrides a removed key can drop the override. On Email branding the buttons now read *Save and continue* / *Discard changes* / *Stay here* instead of *Save and switch* / *Discard and switch* / *Stay*.
