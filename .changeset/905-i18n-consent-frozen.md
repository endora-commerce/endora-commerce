---
'@endora-commerce/mod-i18n': patch
---

Adds the sentences, in English and Polish, for the two refusals a return's consent earns when an operator tries to record or revoke it on a settled case (`errors.INVALID_TRANSITION.consent_frozen`) or on a case in a terminal status (`errors.INVALID_TRANSITION.case_closed`, #905). The settlement form's refund-method label now reads "Refund payment method" ("Metoda zwrotu pieniędzy"), since the field offers methods by name.
