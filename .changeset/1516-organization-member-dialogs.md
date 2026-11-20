---
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-i18n': patch
---

The Organization detail screen's members are one *Members* section (issue #1516).

- `@endora-commerce/mod-organizations`: the *Invite member* and *Direct add member* cards are gone. The *Members* section lists each member as a row with the member's role as a badge, and offers one **Add member** button. It opens a dialog that asks whether to send an invitation or create the account now. Only the second asks for the names, a temporary password and the member's `customer` custom fields. The form is checked when it is submitted, and each problem is shown at its field.
- The bordered edit box above the members table is replaced by an **Edit** dialog. It holds the e-mail, the names and the role, and saves them together. The row no longer holds a role select that saved as soon as an option was picked. If the member was changed elsewhere, the dialog reloads the current values and says so.
- **Remove** asks for confirmation first, and a refused removal is shown in that dialog. The last administrator can be neither removed nor demoted, and the reason is shown. Without `customers:manage` the list is read-only. A personal Organization offers no **Add member**.
- The routes, their bodies, their permissions and their audit entries are unchanged. The new strings ship in the module's bundle under `members.*` (en, pl).
- `@endora-commerce/mod-i18n` drops ten `organizations.detail.*` strings that nothing reads any more: `inviteCard`, `directAddCard`, `nameCol`, `actions`, `roleForLabel`, `twoFactor`, `twoFactorOn`, `verified`, `lastLogin` and `error.versionConflictMember`.
