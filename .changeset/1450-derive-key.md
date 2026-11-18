---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-custom-fields': patch
---

Keys and codes are proposed from the name instead of typed by hand (issue #1450). The admin kit's
`./lib` exports `deriveKey(name, { separator, maxLength })`, built on the contracts' `slugify` with
its diacritic fold, and `useDerivedKey`, the field behaviour that goes with it: the key follows the
name until the operator edits it, is normalised on blur, and a cleared key follows the name again.

- The Tasks status and priority dialogs take the new code from the English name, and the CRM status
  dialog from the default name (issue #1560). A code already in the list is refused at the code, and
  so is the server's own collision, never with a suffix added. The code hint now says where the code
  comes from and that it cannot be changed later.
- The custom-field definition form takes the new key from the default label, which now has the focus
  when the form opens, and refuses a key the record type already has before sending it (issue #1531).
  The key help is shortened to the same sentence.

The API is unchanged: the server still refuses a malformed or taken code, and existing codes and keys
are not changed.
